"""Unified AI workspace query API.

This first iteration is a read-only deterministic query planner over the portal's existing
local pilot data. It intentionally does not claim to be an LLM answer engine or an external
QMS/PLM/Feishu adapter. Each answer carries source labels and explicit integration caveats.
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import (
    REC_IMPORTED,
    PMProject,
    PMProjectMilestone,
    PMProjectRisk,
    ProblemRecord,
    StandardPart,
    StandardBomRun,
)

router = APIRouter(prefix="/api/assistant", tags=["assistant"])

Domain = Literal["auto", "quality", "projects", "problems", "standardization"]


class AssistantQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(min_length=1, max_length=2000)
    domain: Domain = "auto"
    context: dict[str, str] = Field(default_factory=dict)


DOMAIN_LABELS = {
    "quality": "质量决策助手",
    "projects": "项目管理",
    "problems": "问题经验",
    "standardization": "标准化与优选件",
}
DOMAIN_ROUTES = {
    "quality": "assistant",
    "projects": "projects",
    "problems": "problems",
    "standardization": "standardization",
}
DOMAIN_KEYWORDS = {
    "quality": ["质量", "机型", "产品型号", "整改", "测试", "验证", "检测报告", "供应商", "制程", "售后", "客诉", "失效", "雷区库", "开发进度"],
    "projects": ["项目管理", "项目进度", "项目", "任务", "周报", "月报", "结项", "DCP", "逾期", "里程碑", "交付件", "规划及时率", "销售达标"],
    "problems": ["问题经验", "问题库", "历史问题", "问题记录", "问题清单", "故障案例", "导入", "整改记录"],
    "standardization": ["物料", "BOM", "优选件", "优选库", "相似件", "零部件", "标准化", "替代件", "物料编码", "选型", "编码申请"],
}
STATUS_LABELS = {
    "normal": "正常",
    "at_risk": "有风险",
    "blocked": "阻塞",
    "completed": "已完成",
}
SEVERITY_LABELS = {
    "CRITICAL": "严重",
    "HIGH": "高",
    "MEDIUM": "中",
    "LOW": "低",
}
GATE_LABELS = {"pending": "待评审", "passed": "已通过", "blocked": "阻塞"}
RISK_LABELS = {"open": "待处理", "monitoring": "跟进中", "resolved": "已解决"}
RISK_LEVEL_LABELS = {"high": "高", "medium": "中", "low": "低"}


def _normalize(value: object) -> str:
    return re.sub(r"[\s\-_./\\]+", "", str(value or "")).casefold()


def _domain_for(question: str, requested: str) -> tuple[Optional[str], list[str], str]:
    if requested != "auto":
        return requested, [], "用户指定业务范围"
    text = question.casefold()
    scores: list[tuple[str, int, list[str]]] = []
    for domain, keywords in DOMAIN_KEYWORDS.items():
        matches = [word for word in keywords if word.casefold() in text]
        # High-signal domain terms weigh more than generic "项目/问题" mentions.
        score = sum(2 if len(word) >= 3 else 1 for word in matches)
        if score:
            scores.append((domain, score, matches))
    scores.sort(key=lambda item: item[1], reverse=True)
    if not scores:
        return None, [], "未能识别明确的业务域"
    # Questions that clearly cross several areas are handled by the quality aggregate view.
    domains_found = {item[0] for item in scores if item[1] >= max(2, scores[0][1] - 1)}
    if len(domains_found) > 1 and any(word in question for word in ("汇总", "综合", "整体", "一起", "同时", "全维度", "一键")):
        return "quality", scores[0][2], "识别为跨域机型信息汇总"
    # For quality's four primary asks, quality terms and a model/validation phrase take precedence.
    if any(word in question for word in ("机型", "型号", "整改", "测试验证", "检测报告", "过程质量", "质量问题")):
        if any(word in question for word in ("项目管理", "周报", "月报", "项目群")):
            pass
        else:
            return "quality", scores[0][2], "识别为质量决策查询"
    return scores[0][0], scores[0][2], "基于业务关键词识别"


def _intent(domain: str, question: str) -> tuple[str, str]:
    if domain == "quality":
        if any(word in question for word in ("整改", "措施", "关闭", "解决情况")):
            return "rectification_status", "整改情况查询"
        if any(word in question for word in ("测试", "验证", "检测报告", "检验标准")):
            return "test_validation", "测试验证情况查询"
        if any(word in question for word in ("进度", "DCP", "开发", "交付")):
            return "development_progress", "机型开发进度查询"
        return "process_quality", "过程质量问题查询"
    if domain == "projects":
        if any(word in question for word in ("DCP", "里程碑", "遗留")):
            return "dcp_tracking", "DCP 关口与遗留事项查询"
        if any(word in question for word in ("风险", "逾期", "预警")):
            return "risk_tracking", "项目风险与逾期查询"
        return "project_progress", "项目进度查询"
    if domain == "standardization":
        if "bom" in question.casefold():
            return "bom_history", "BOM 校验查询"
        if any(word in question for word in ("相似", "查重", "替代")):
            return "similar_parts", "相似件查询"
        return "preferred_parts", "优选件与物料查询"
    return "problem_records", "问题经验记录查询"


def _extract_model(question: str, context: dict[str, str], known_models: list[str]) -> str:
    existing = str(context.get("product_model") or "").strip()
    if existing:
        return existing
    # Prefer known aliases / model identifiers that appear verbatim in the question.
    matched = [item for item in known_models if item and len(item.strip()) >= 2 and _normalize(item) in _normalize(question)]
    if matched:
        return max(matched, key=len).strip()
    patterns = [
        r"(?:机型编号|产品型号|机型|型号|推广名)\s*[:：为是]?\s*([A-Za-z0-9][A-Za-z0-9._-]{1,31})",
        r"\b([A-Z]{1,5}[-_]?[A-Z0-9]{2,}(?:[-_][A-Z0-9]+)*)\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, question, flags=re.IGNORECASE)
        if match:
            return match.group(1).strip()
    return ""


def _extract_time_floor(question: str) -> Optional[datetime]:
    today = date.today()
    if "近7天" in question or "最近7天" in question or "过去7天" in question:
        return datetime.combine(today - timedelta(days=7), datetime.min.time())
    if "近30天" in question or "最近30天" in question or "过去30天" in question or "近一个月" in question:
        return datetime.combine(today - timedelta(days=30), datetime.min.time())
    if "本月" in question or "这个月" in question:
        return datetime.combine(today.replace(day=1), datetime.min.time())
    if "上月" in question or "上个月" in question:
        first = today.replace(day=1)
        last_month_end = first - timedelta(days=1)
        return datetime.combine(last_month_end.replace(day=1), datetime.min.time())
    if "今年" in question or "本年" in question:
        return datetime.combine(today.replace(month=1, day=1), datetime.min.time())
    match = re.search(r"(20\d{2}-\d{2}-\d{2})\s*(?:到|至|~|—|-)\s*(20\d{2}-\d{2}-\d{2})", question)
    if match:
        try:
            return datetime.combine(date.fromisoformat(match.group(1)), datetime.min.time())
        except ValueError:
            return None
    return None


def _filter_words(question: str) -> list[str]:
    ignored = set("帮我查询查看一下这个那个最近当前项目机型编号产品型号推广名质量问题整改情况状态进度有哪些怎么怎么样汇总所有全部数据记录".split())
    tokens = re.findall(r"[\u4e00-\u9fff]{2,}|[A-Za-z0-9][A-Za-z0-9._-]{1,}", question)
    return [token for token in tokens if token not in ignored and len(token) >= 2]


def _problem_item(row: ProblemRecord) -> dict:
    status_hint = "整改信息待补充"
    if (row.countermeasure or "").strip() and (row.result or "").strip():
        status_hint = "已有措施与结果记录（需人工确认闭环）"
    elif (row.countermeasure or "").strip():
        status_hint = "已记录措施，结果待补充"
    return {
        "id": row.id,
        "title": (row.description or "").strip() or "未填写问题描述",
        "subtitle": "问题经验 #%s · 批次 #%s" % (row.id, row.batch_id),
        "status": status_hint,
        "fields": [
            {"label": "机型", "value": row.model or "未填写"},
            {"label": "问题分类", "value": row.category or "未分类"},
            {"label": "严重度", "value": SEVERITY_LABELS.get((row.severity or "").upper(), row.severity or "未评估")},
            {"label": "责任部门", "value": row.dept or "未指定"},
            {"label": "责任人", "value": row.owner or "未指定"},
            {"label": "登记时间", "value": row.created_at.strftime("%Y-%m-%d")},
            {"label": "整改截止", "value": row.due_date or "未设置"},
        ],
        "source_id": "problem_records:%s" % row.id,
        "source_name": "门户本地问题台账",
        "updated_at": row.created_at.strftime("%Y-%m-%d %H:%M"),
        "detail": (("措施：" + row.countermeasure.strip()) if row.countermeasure and row.countermeasure.strip() else "") +
                  (("；结果：" + row.result.strip()) if row.result and row.result.strip() else ""),
    }


def _project_item(project: PMProject, milestones: list[PMProjectMilestone], risks: list[PMProjectRisk]) -> dict:
    passed = sum(1 for item in milestones if item.status == "passed")
    open_risks = [item for item in risks if item.status != "resolved"]
    today = date.today().isoformat()
    overdue_gates = [item for item in milestones if item.status != "passed" and item.planned_date < today]
    overdue_risks = [item for item in open_risks if item.due_date and item.due_date < today]
    return {
        "id": project.id,
        "title": project.name,
        "subtitle": "%s · %s · %s" % (project.code, project.product_line or "未设置产品线", project.owner or "待指定"),
        "status": STATUS_LABELS.get(project.status, project.status),
        "fields": [
            {"label": "阶段", "value": project.stage},
            {"label": "项目进度", "value": "%s%%" % project.progress},
            {"label": "计划结束", "value": project.planned_end or "未设置"},
            {"label": "DCP 通过", "value": "%s / %s" % (passed, len(milestones))},
            {"label": "未关闭风险", "value": str(len(open_risks))},
            {"label": "逾期关口", "value": str(len(overdue_gates))},
            {"label": "逾期风险", "value": str(len(overdue_risks))},
        ],
        "source_id": "pm_projects:%s" % project.id,
        "source_name": "门户本地项目管理试点",
        "updated_at": project.updated_at.strftime("%Y-%m-%d %H:%M"),
        "detail": project.description or "",
    }


def _milestone_item(row: PMProjectMilestone, project: PMProject) -> dict:
    overdue = row.status != "passed" and row.planned_date < date.today().isoformat()
    return {
        "id": row.id,
        "title": "%s · %s" % (row.gate, row.title),
        "subtitle": "%s · %s" % (project.code, project.name),
        "status": "已逾期" if overdue else GATE_LABELS.get(row.status, row.status),
        "fields": [
            {"label": "计划日期", "value": row.planned_date},
            {"label": "实际日期", "value": row.actual_date or "未记录"},
            {"label": "负责人", "value": row.owner or "待指定"},
        ],
        "source_id": "pm_project_milestones:%s" % row.id,
        "source_name": "门户本地 DCP 试点",
        "updated_at": row.created_at.strftime("%Y-%m-%d %H:%M"),
        "detail": row.notes or "",
    }


def _risk_item(row: PMProjectRisk, project: PMProject) -> dict:
    overdue = row.status != "resolved" and row.due_date and row.due_date < date.today().isoformat()
    return {
        "id": row.id,
        "title": row.title,
        "subtitle": "%s · %s · %s风险" % (project.code, project.name, RISK_LEVEL_LABELS.get(row.level, row.level)),
        "status": ("已逾期 · " if overdue else "") + RISK_LABELS.get(row.status, row.status),
        "fields": [
            {"label": "等级", "value": RISK_LEVEL_LABELS.get(row.level, row.level)},
            {"label": "责任人", "value": row.owner or "待指定"},
            {"label": "截止日期", "value": row.due_date or "未设置"},
        ],
        "source_id": "pm_project_risks:%s" % row.id,
        "source_name": "门户本地风险试点",
        "updated_at": row.created_at.strftime("%Y-%m-%d %H:%M"),
        "detail": row.mitigation or "尚未填写应对措施。",
    }


def _part_item(row: StandardPart) -> dict:
    return {
        "id": row.id,
        "title": row.name,
        "subtitle": "%s · %s · %s" % (row.part_no, row.category, row.specification or "未填写规格"),
        "status": ("优选件 · " if row.is_preferred else "") + {"active": "有效", "pending": "待审核", "deprecated": "已停用"}.get(row.lifecycle, row.lifecycle),
        "fields": [
            {"label": "制造商", "value": row.manufacturer or "未填写"},
            {"label": "优选件", "value": "是" if row.is_preferred else "否"},
            {"label": "生命周期", "value": row.lifecycle},
            {"label": "替代编码", "value": row.replacement_part_no or "未指定"},
        ],
        "source_id": "standard_parts:%s" % row.id,
        "source_name": "门户本地物料目录",
        "updated_at": row.updated_at.strftime("%Y-%m-%d %H:%M"),
        "detail": row.notes or "",
    }


def _group(title: str, source: str, items: list[dict]) -> dict:
    return {"title": title, "source": source, "count": len(items), "items": items}


def _metrics(items: list[tuple[str, object, str]]) -> list[dict]:
    return [{"label": label, "value": value, "detail": detail} for label, value, detail in items]


@router.post("/query")
def query_assistant(payload: AssistantQuery, db: Session = Depends(get_db)):
    question = payload.question.strip()
    if not question:
        return {"status": "needs_clarification", "kind": "clarify", "message": "请输入你想查询的问题。", "options": list(DOMAIN_LABELS)}
    domain, matched, method = _domain_for(question, payload.domain)
    if not domain:
        return {
            "status": "needs_clarification",
            "kind": "clarify",
            "message": "我还不确定你想问哪个业务域。请选择一个方向，或补充机型、项目、物料等关键词。",
            "options": [
                {"key": "quality", "label": DOMAIN_LABELS["quality"], "description": "机型进度、过程质量问题、整改与测试验证"},
                {"key": "projects", "label": DOMAIN_LABELS["projects"], "description": "项目进度、DCP、任务、逾期风险与报告"},
                {"key": "problems", "label": DOMAIN_LABELS["problems"], "description": "问题经验记录、历史问题和整改字段"},
                {"key": "standardization", "label": DOMAIN_LABELS["standardization"], "description": "物料、相似件、优选件与 BOM"},
            ],
            "query_mode": "read_only_local_pilot",
        }

    intent, intent_label = _intent(domain, question)
    groups: list[dict] = []
    metrics: list[dict] = []
    context = dict(payload.context)
    date_floor = _extract_time_floor(question)
    filter_date_text = "从 %s 起" % date_floor.date().isoformat() if date_floor else "未指定时间范围"

    known_models = [row[0] for row in db.query(ProblemRecord.model).filter(ProblemRecord.model.isnot(None)).distinct().all() if row[0]]
    model_filter = _extract_model(question, context, known_models)
    context_out = dict(context)
    if model_filter:
        context_out["product_model"] = model_filter

    caveats = [
        "当前查询范围为门户本地试点数据，不代表已同步企业 QMS、PLM、飞书或独立业务系统。",
        "本结果由确定性规则查询生成，不是大模型推理；未查询到的数据不会用模型补写。",
    ]

    if domain in {"quality", "problems"}:
        query = db.query(ProblemRecord).filter(ProblemRecord.status == REC_IMPORTED)
        if model_filter:
            pattern = "%" + model_filter + "%"
            query = query.filter(or_(ProblemRecord.model.ilike(pattern), ProblemRecord.description.ilike(pattern)))
        elif domain == "problems":
            tokens = [token for token in _filter_words(question) if token.casefold() not in {"记录", "问题经验"}][:4]
            if tokens:
                conditions = []
                for token in tokens:
                    pattern = "%" + token + "%"
                    conditions.extend([
                        ProblemRecord.description.ilike(pattern),
                        ProblemRecord.category.ilike(pattern),
                        ProblemRecord.dept.ilike(pattern),
                        ProblemRecord.model.ilike(pattern),
                    ])
                query = query.filter(or_(*conditions))
        if date_floor:
            query = query.filter(ProblemRecord.created_at >= date_floor)
        records = query.order_by(ProblemRecord.created_at.desc(), ProblemRecord.id.desc()).limit(20).all()
        mapped = [_problem_item(row) for row in records]
        groups.append(_group("问题经验记录", "门户本地问题台账", mapped))
        total_q = db.query(ProblemRecord).filter(ProblemRecord.status == REC_IMPORTED)
        if model_filter:
            pattern = "%" + model_filter + "%"
            total_q = total_q.filter(or_(ProblemRecord.model.ilike(pattern), ProblemRecord.description.ilike(pattern)))
        if date_floor:
            total_q = total_q.filter(ProblemRecord.created_at >= date_floor)
        total_records = total_q.count()
        critical_count = sum(1 for row in records if (row.severity or "").upper() in {"CRITICAL", "HIGH"})
        with_action = sum(1 for row in records if row.countermeasure and row.countermeasure.strip())
        with_result = sum(1 for row in records if row.result and row.result.strip())
        metrics.extend([
            ("命中记录", total_records, "符合当前筛选条件的本地记录"),
            ("高 / 严重", critical_count, "当前返回记录中的高等级项"),
            ("已填措施", with_action, "当前返回记录存在措施字段"),
            ("已填结果", with_result, "当前返回记录存在结果字段"),
        ])
        if intent == "rectification_status":
            caveats.append("当前本地模型没有经过业务批准的整改闭环状态字段；“已填结果”只代表结果栏有内容，不等于正式验收通过或整改关闭。")
        if model_filter and total_records == 0:
            caveats.append("没有找到与机型 / 型号“%s”匹配的本地记录；请核对编号或推广名映射。" % model_filter)

        # For the quality assistant, also aggregate matching project and DCP summaries.
        if domain == "quality":
            project_query = db.query(PMProject)
            if model_filter:
                pattern = "%" + model_filter + "%"
                project_query = project_query.filter(or_(
                    PMProject.code.ilike(pattern), PMProject.name.ilike(pattern),
                    PMProject.product_line.ilike(pattern), PMProject.description.ilike(pattern),
                ))
            projects = project_query.order_by(PMProject.updated_at.desc()).limit(10).all()
            if not model_filter and not projects:
                projects = db.query(PMProject).order_by(PMProject.updated_at.desc()).limit(5).all()
            project_items = []
            milestone_items = []
            risk_items = []
            for project in projects:
                milestones = db.query(PMProjectMilestone).filter(PMProjectMilestone.project_id == project.id).order_by(PMProjectMilestone.planned_date.asc()).all()
                risks = db.query(PMProjectRisk).filter(PMProjectRisk.project_id == project.id).order_by(PMProjectRisk.id.desc()).all()
                project_items.append(_project_item(project, milestones, risks))
                milestone_items.extend(_milestone_item(row, project) for row in milestones if row.status != "passed")
                risk_items.extend(_risk_item(row, project) for row in risks if row.status != "resolved")
            groups.append(_group("项目开发进度", "门户本地项目管理试点", project_items))
            if intent in {"development_progress", "rectification_status"}:
                groups.append(_group("未通过 DCP 关口", "门户本地 DCP 试点", milestone_items[:12]))
            if intent == "process_quality" or any(word in question for word in ("风险", "遗留", "异常")):
                groups.append(_group("项目未关闭风险", "门户本地风险试点", risk_items[:12]))
            metrics.extend([
                ("关联项目", len(project_items), "本地项目匹配结果"),
                ("未通过 DCP", len(milestone_items), "关联项目中未通过的关口"),
                ("未关闭风险", len(risk_items), "关联项目中的未解决风险"),
            ])

    elif domain == "projects":
        project_query = db.query(PMProject)
        known_project_codes = [row[0] for row in db.query(PMProject.code).all() if row[0]]
        known_projects = [(row.name, row.code, row.product_line) for row in db.query(PMProject).all()]
        project_match = next((row for row in sorted(known_projects, key=lambda item: len(item[0] or ""), reverse=True)
                              if any(value and _normalize(value) in _normalize(question) for value in row)), None)
        if project_match:
            pattern = "%" + (project_match[1] or project_match[0]) + "%"
            project_query = project_query.filter(or_(PMProject.code.ilike(pattern), PMProject.name.ilike(pattern)))
        else:
            code_match = next((code for code in known_project_codes if _normalize(code) in _normalize(question)), "")
            if code_match:
                project_query = project_query.filter(PMProject.code == code_match)
        projects = project_query.order_by(PMProject.updated_at.desc()).limit(20).all()
        project_items = []
        milestone_items = []
        risk_items = []
        for project in projects:
            milestones = db.query(PMProjectMilestone).filter(PMProjectMilestone.project_id == project.id).order_by(PMProjectMilestone.planned_date.asc()).all()
            risks = db.query(PMProjectRisk).filter(PMProjectRisk.project_id == project.id).order_by(PMProjectRisk.id.desc()).all()
            project_items.append(_project_item(project, milestones, risks))
            milestone_items.extend(_milestone_item(row, project) for row in milestones if row.status != "passed")
            risk_items.extend(_risk_item(row, project) for row in risks if row.status != "resolved")
        groups.append(_group("项目进度", "门户本地项目管理试点", project_items))
        if intent in {"dcp_tracking", "project_progress"} or any(word in question for word in ("DCP", "里程碑", "遗留")):
            filtered_gates = sorted(milestone_items, key=lambda item: item["fields"][0]["value"])
            groups.append(_group("未通过 DCP 关口", "门户本地 DCP 试点", filtered_gates[:20]))
        if intent == "risk_tracking" or any(word in question for word in ("风险", "逾期", "预警")):
            risk_items.sort(key=lambda item: ("逾期" not in item["status"], item["status"]))
            groups.append(_group("未关闭项目风险", "门户本地风险试点", risk_items[:20]))
        metrics.extend([
            ("匹配项目", len(project_items), "当前本地项目记录"),
            ("未通过 DCP", len(milestone_items), "关联项目中待评审、阻塞或逾期关口"),
            ("未关闭风险", len(risk_items), "关联项目中的待处理与跟进中风险"),
        ])

    elif domain == "standardization":
        parts_query = db.query(StandardPart)
        if any(word in question for word in ("优选件", "优选库")) and not any(word in question for word in ("相似件", "查重")):
            parts_query = parts_query.filter(StandardPart.is_preferred.is_(True), StandardPart.lifecycle == "active")
        elif any(word in question for word in ("有效", "可用", "在用")):
            parts_query = parts_query.filter(StandardPart.lifecycle == "active")
        known_parts = db.query(StandardPart).all()
        exact_hits = [row for row in known_parts if row.part_no and _normalize(row.part_no) in _normalize(question)]
        if exact_hits:
            ids = [row.id for row in exact_hits]
            parts_query = parts_query.filter(StandardPart.id.in_(ids))
        elif not any(word in question for word in ("优选件", "优选库", "物料", "bom", "BOM", "零部件", "标准化")):
            tokens = _filter_words(question)[:5]
            if tokens:
                clauses = []
                for token in tokens:
                    pattern = "%" + token + "%"
                    clauses.extend([StandardPart.part_no.ilike(pattern), StandardPart.name.ilike(pattern), StandardPart.specification.ilike(pattern), StandardPart.category.ilike(pattern)])
                parts_query = parts_query.filter(or_(*clauses))
        parts = parts_query.order_by(StandardPart.is_preferred.desc(), StandardPart.lifecycle.asc(), StandardPart.part_no.asc()).limit(20).all()
        part_items = [_part_item(row) for row in parts]
        groups.append(_group("物料 / 优选件", "门户本地物料目录", part_items))
        preferred_total = db.query(StandardPart).filter(StandardPart.is_preferred.is_(True), StandardPart.lifecycle == "active").count()
        bom_runs = db.query(StandardBomRun).order_by(StandardBomRun.id.desc()).limit(5).all()
        if "bom" in question.casefold() or "校验历史" in question:
            groups.append(_group("最近 BOM 校验", "门户本地 BOM 规则试点", [{
                "id": run.id, "title": run.bom_name, "subtitle": "BOM 校验 #%s" % run.id,
                "status": "校验记录", "fields": [
                    {"label": "物料行", "value": str(run.total_items)},
                    {"label": "合规行", "value": str(run.compliant_items)},
                    {"label": "待复核", "value": str(run.review_items)},
                    {"label": "阻断行", "value": str(run.blocked_items)},
                ], "source_id": "standard_bom_runs:%s" % run.id,
                "source_name": "门户本地 BOM 规则试点",
                "updated_at": run.created_at.strftime("%Y-%m-%d %H:%M"),
                "detail": "仅为当前本地规则检查记录，不代表 PLM 正式放行。",
            } for run in bom_runs]))
        metrics.extend([
            ("返回物料", len(part_items), "当前本地目录结果"),
            ("有效优选件", preferred_total, "已标记优选且生命周期有效"),
            ("BOM 校验次数", db.query(StandardBomRun).count(), "本地历史记录"),
        ])
        caveats.append("相似件与优选件结论基于本地物料目录和确定性规则，不代表 PLM 实时数据或正式工程放行。")

    # Keep metric values numeric/string but derived entirely from records returned by existing local tables.
    metrics_out = _metrics(metrics)
    group_count = sum(group["count"] for group in groups)
    status = "answered" if group_count else "no_data"
    if status == "no_data":
        answer = "在当前门户本地试点数据中没有找到符合条件的记录。你可以核对编号、放宽时间范围，或进入对应系统查看完整数据。"
    elif domain == "quality":
        answer = "已按“%s”整理本地可用记录。当前匹配到 %s 条问题记录、%s 个项目；详见下方明细与来源。真实 QMS / PLM / 飞书数据尚未接入。" % (
            intent_label,
            next((metric["value"] for metric in metrics_out if metric["label"] == "命中记录"), 0),
            next((metric["value"] for metric in metrics_out if metric["label"] == "关联项目"), 0),
        )
    elif domain == "projects":
        answer = "已查询门户本地项目管理试点，返回 %s 个项目、%s 个未通过 DCP 关口和 %s 项未关闭风险。独立 PM 系统数据尚未同步。" % (
            next((metric["value"] for metric in metrics_out if metric["label"] == "匹配项目"), 0),
            next((metric["value"] for metric in metrics_out if metric["label"] == "未通过 DCP"), 0),
            next((metric["value"] for metric in metrics_out if metric["label"] == "未关闭风险"), 0),
        )
    elif domain == "standardization":
        answer = "已查询门户本地物料目录与 BOM 规则记录。结果来自本地试点，不会自动更新 PLM，也不能作为正式物料替代或 BOM 发布放行结论。"
    else:
        answer = "已从门户本地问题台账检索记录。整改措施和结果字段用于辅助核对，不代表业务负责人已完成正式闭环验收。"

    evidence = []
    for group in groups:
        for item in group["items"]:
            evidence.append({
                "source_system": item["source_name"],
                "record_id": item["source_id"],
                "updated_at": item["updated_at"],
                "title": item["title"],
            })
    evidence = evidence[:60]
    return {
        "status": status,
        "kind": "answer",
        "query_mode": "read_only_local_pilot",
        "domain": domain,
        "domain_label": DOMAIN_LABELS[domain],
        "route": DOMAIN_ROUTES[domain],
        "intent": intent,
        "intent_label": intent_label,
        "method": method,
        "matched_keywords": matched,
        "filters": {"product_model": model_filter or None, "time_range": filter_date_text},
        "context": context_out,
        "answer": answer,
        "metrics": metrics_out,
        "groups": groups,
        "evidence": evidence,
        "caveats": caveats,
        "suggested_questions": (
            ["这个机型还有哪些整改结果未补充？", "这个机型还有哪些 DCP 关口未通过？", "查看最近 30 天质量问题"]
            if domain == "quality" else
            ["哪些项目存在逾期风险？", "接下来 14 天有哪些 DCP？", "生成项目周报数据摘要"]
            if domain == "projects" else
            ["有哪些有效优选件？", "查看最近 BOM 校验历史", "查询某个物料编码"]
            if domain == "standardization" else
            ["近 30 天新增了哪些问题？", "哪些问题还没有填写措施？", "查询指定机型的问题记录"]
        ),
        "evidence_count": len(evidence),
    }
