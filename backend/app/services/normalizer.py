"""字段归一化与规则校验。

问题分级：
- error（必填缺失 / 枚举非法）：阻断入库，必须人工修改或该行被剔除；
- warning（日期无法识别已置空、非必填空值等）：不阻断，但在预览中明示。
猜测值永远不会被静默写入：枚举非法时保留原值并报错，不做自动替换。
"""
from __future__ import annotations

import difflib
import re
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple

from .mapping import (
    REQUIRED_FIELDS,
    SEVERITY_ENUM,
)

_DATE_PATTERNS = [
    re.compile(r"^(\d{4})[/.\-](\d{1,2})[/.\-](\d{1,2})$"),
    re.compile(r"^(\d{4})年(\d{1,2})月(\d{1,2})日?$"),
]

_EMPTY_TOKENS = {"/", "\\", "-", "--", "—", "无", "n/a", "na", "NA", "N/A", ""}

# 常见中文等级写法 -> 标准枚举（属于确定的同义词归一，不是猜测）
_SEVERITY_ALIASES = {
    "严重": "A",
    "高": "A",
    "a级": "A",
    "一般": "B",
    "中": "B",
    "b级": "B",
    "轻微": "C",
    "低": "C",
    "c级": "C",
}


def is_blank(value: Any) -> bool:
    if value is None:
        return True
    return str(value).strip() in _EMPTY_TOKENS


def text_or_none(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    text = str(value).strip()
    return None if text in _EMPTY_TOKENS else text


def normalize_date(value: Any) -> Tuple[Optional[str], Optional[dict]]:
    """多种日期写法 -> ISO 字符串；失败置空并给 warning。"""
    if value is None or (isinstance(value, str) and not value.strip()):
        return None, None
    if isinstance(value, datetime):
        return value.date().isoformat(), None
    if isinstance(value, date):
        return value.isoformat(), None
    text = str(value).strip()
    if text in _EMPTY_TOKENS:
        return None, None
    for pat in _DATE_PATTERNS:
        m = pat.match(text)
        if m:
            try:
                y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
                return date(y, mo, d).isoformat(), None
            except ValueError:
                break
    return None, {
        "level": "warning",
        "message": "日期无法识别（应为 2026-09-01 这类格式），已置空：%s" % text,
    }


def normalize_severity(value: Any) -> Tuple[Optional[str], Optional[dict]]:
    text = text_or_none(value)
    if text is None:
        return None, None
    upper = text.upper()
    if upper in SEVERITY_ENUM:
        return upper, None
    alias = _SEVERITY_ALIASES.get(text.lower())
    if alias:
        return alias, None
    suggestion = None
    close = difflib.get_close_matches(text, SEVERITY_ENUM, n=1, cutoff=0.4)
    if close:
        suggestion = close[0]
    issue = {
        "level": "error",
        "message": "严重度 '%s' 不在标准枚举（A-严重 / B-一般 / C-轻微）内" % text,
    }
    if suggestion:
        issue["suggestion"] = suggestion
    return text, issue


def validate_row(values: Dict[str, Optional[str]]) -> List[dict]:
    """对一行已归一数据执行校验，返回 issue 列表（含字段、级别、原因）。"""
    issues: List[dict] = []

    # 1. 必填项
    for field in REQUIRED_FIELDS:
        if is_blank(values.get(field)):
            issues.append({
                "field": field,
                "level": "error",
                "message": "必填项「问题描述」为空",
            })

    return issues


def normalize_row(raw_values: Dict[str, Any]) -> Tuple[Dict[str, Optional[str]], List[dict]]:
    """把单元格原始值按目标字段归一化，返回 (归一值, issues)。

    raw_values 的 key 为映射后的目标字段，value 为单元格原始内容。
    未映射列不进入本函数。
    """
    out: Dict[str, Optional[str]] = {}
    issues: List[dict] = []

    for field, raw in raw_values.items():
        if field == "due_date":
            val, issue = normalize_date(raw)
            out[field] = val
            if issue:
                issues.append({"field": field, **issue})
        elif field == "severity":
            val, issue = normalize_severity(raw)
            out[field] = val
            if issue:
                issues.append({"field": field, **issue})
        else:
            out[field] = text_or_none(raw)

    issues.extend(validate_row(out))
    return out, issues
