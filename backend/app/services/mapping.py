"""表头语义映射：同义词词典与置信度匹配。

业务口径沿用已验收的 problem-hub 规则（精确 1.0 / 同义词 0.9 / 包含 0.7），
V0.1 只保留问题库核心字段，图片/关闭签字段在后续版本迁移。
"""
from __future__ import annotations

import re
from typing import Dict, List, Optional, Tuple

# 目标字段 -> 同义词表头
FIELD_SYNONYMS: Dict[str, List[str]] = {
    "description": ["问题描述", "问题点", "问题", "不良描述", "描述", "测试项目", "事项"],
    "category": ["分类", "问题分类", "类别", "测试类别", "问题类别"],
    "dept": ["责任部门", "归属部门", "牵头部门", "处理部门", "部门"],
    "model": ["机型", "产品型号", "型号", "产品"],
    "severity": ["问题等级", "等级", "严重度", "严重程度", "级别"],
    "owner": ["负责人", "责任人", "处理人"],
    "submitter": ["提交人", "提出人", "上报人"],
    "due_date": ["目标解决时间", "目标完成时间", "计划完成时间", "解决时间", "完成时间", "截止日期"],
    "countermeasure": ["改善对策", "对策", "纠正措施", "处理措施", "措施"],
    "result": ["改善结果", "结果", "处理结果", "进度", "关闭情况"],
    "source": ["来源", "问题来源", "发生环节"],
    "stage": ["阶段", "试制阶段", "所属阶段"],
}

# 必填字段
REQUIRED_FIELDS = ["description"]

# 枚举字段与标准值
SEVERITY_ENUM = ["A", "B", "C"]
SEVERITY_LABELS = {"A": "A-严重", "B": "B-一般", "C": "C-轻微"}
SOURCE_ENUM = ["制造/工艺", "来料", "测试"]

# 字段中文展示名
FIELD_LABELS = {
    "description": "问题描述",
    "category": "问题分类",
    "dept": "责任部门",
    "model": "机型",
    "severity": "严重度",
    "owner": "负责人",
    "submitter": "提出人",
    "due_date": "计划完成日期",
    "countermeasure": "改善对策",
    "result": "改善结果",
    "source": "问题来源",
    "stage": "阶段",
}

DATA_FIELDS = list(FIELD_SYNONYMS.keys())

_PUNCT_RE = re.compile(r"[\s　\n\r\t.,，。、:：;；/\\\-_()（）\[\]【】*]+")


def normalize_header(raw: object) -> str:
    if raw is None:
        return ""
    return _PUNCT_RE.sub("", str(raw)).lower()


def match_header(raw: object) -> Tuple[Optional[str], float]:
    """返回 (目标字段, 置信度)；未命中返回 (None, 0.0)。"""
    norm = normalize_header(raw)
    if not norm:
        return None, 0.0
    for field, synonyms in FIELD_SYNONYMS.items():
        for cand in synonyms:
            if norm == normalize_header(cand):
                return field, 0.9
    best_field, best_score = None, 0.0
    for field, synonyms in FIELD_SYNONYMS.items():
        for cand in synonyms:
            nc = normalize_header(cand)
            if len(nc) < 2:
                continue
            if nc in norm:
                score = 0.7
            elif norm in nc:
                score = 0.7 * len(norm) / len(nc)
            else:
                continue
            if score > best_score:
                best_field, best_score = field, score
    if best_field and best_score >= 0.5:
        return best_field, round(min(best_score, 0.7), 2)
    return None, 0.0


def confidence_level(score: float) -> str:
    """high=可直接采用；medium=待人工确认；none=未映射。"""
    if score >= 0.9:
        return "high"
    if score >= 0.5:
        return "medium"
    return "none"


def detect_header_row(grid: List[List[object]], max_scan: int = 5) -> Optional[int]:
    """前 max_scan 行中评分最优行（命中 >=3 个不同字段，description 命中加分）。"""
    best_idx, best_score = None, 0.0
    for idx, row in enumerate(grid[:max_scan]):
        score, fields = 0.0, set()
        for cell in row:
            field, conf = match_header(cell)
            if field:
                fields.add(field)
                score += conf
        if len(fields) < 3:
            continue
        if "description" in fields:
            score += 1.0
        if score > best_score:
            best_idx, best_score = idx, score
    return best_idx
