"""表头识别器抽象 —— 大模型接入预留点。

V0.1 只有规则词典实现（RuleBasedRecognizer），行为可验证、可单测。
后续接入大模型时新增 LLMRecognizer 实现本接口，并通过 RECOGNIZER_ENGINE=llm
切换；要求：
1. LLM 输出必须是结构化字段名，落在 DATA_FIELDS 白名单内，非法输出丢弃；
2. 低置信度映射仍须进人工确认，禁止把猜测结果直接当成确定事实；
3. 建议先 shadow 运行（规则结果 vs LLM 结果对照），达标后再灰度放量。
"""
from __future__ import annotations

import abc
from typing import List, Optional, Tuple

from ..config import RECOGNIZER_ENGINE
from .mapping import match_header


class HeaderRecognizer(abc.ABC):
    @abc.abstractmethod
    def recognize(self, raw_headers: List[object]) -> List[Tuple[Optional[str], float]]:
        """输入一行原始表头，按列序返回 (目标字段, 置信度)。"""
        raise NotImplementedError


class RuleBasedRecognizer(HeaderRecognizer):
    """同义词词典 + 包含匹配，当前唯一生产实现。"""

    def recognize(self, raw_headers: List[object]) -> List[Tuple[Optional[str], float]]:
        return [match_header(h) for h in raw_headers]


class LLMRecognizer(HeaderRecognizer):
    """占位实现：接口形态固定，依赖模型服务后补全，当前被选择时显式报错。"""

    def __init__(self):
        raise RuntimeError(
            "LLMRecognizer 尚未接入：V0.1 使用规则识别（RECOGNIZER_ENGINE=rule）。"
            "接入时须实现结构化输出校验与 shadow 对照，见本文件模块说明。"
        )

    def recognize(self, raw_headers: List[object]) -> List[Tuple[Optional[str], float]]:
        raise NotImplementedError


def get_recognizer() -> HeaderRecognizer:
    if RECOGNIZER_ENGINE == "llm":
        return LLMRecognizer()
    return RuleBasedRecognizer()
