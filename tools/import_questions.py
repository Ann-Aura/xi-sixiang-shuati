from __future__ import annotations

import json
import re
import sys
from collections import Counter
from hashlib import sha1
from pathlib import Path

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PDF = Path(
    "C:/Users/XiaoAn/Desktop/obsidian/课内笔记类/习思想/习思想知识点及练习题.pdf"
)
OUT_DIR = ROOT / "data"
OUT_FILE = OUT_DIR / "questions.js"
ISSUE_FILE = OUT_DIR / "import_issues.json"

CN_NUM = "一二三四五六七八九十"
REF = "参考答案"
KNOWLEDGE = "知识点"
SINGLE = "单选题"
MULTIPLE = "多选题"
MULTIPLE_ALT = "多项选择题"
BRIEF = "简答题"
EXCLUDED_BRIEF_CHAPTERS = {
    "第十三章 维护和塑造国家安全",
    "第十四章 建设巩固国防和强大人民军队",
}

CHAPTER_RE = re.compile(
    rf"(导\s*论|第[{CN_NUM}]+章\s*[^\n]+(\n[^\n]{{2,28}})?)"
)
TYPE_RE = re.compile(
    rf"([（(][{CN_NUM}]+[）)]\s*)?([{CN_NUM}]+、\s*)?"
    rf"({SINGLE}|{MULTIPLE}|{MULTIPLE_ALT})"
)
STOP_RE = re.compile(
    rf"([{CN_NUM}]+、\s*)?(简答题|判断题|论述题|材料分析)"
)
QUESTION_RE = re.compile(r"(?m)^\s*(\d+)\s*[\.．、]\s*")
OPTION_RE = re.compile(r"(?m)^\s*([A-D])\s*[\.．、]\s*")
INLINE_ANSWER_RE = re.compile(rf"(?:{REF}|答案)\s*[：:]?\s*([A-D][A-D\s]*)")
BRIEF_RE = re.compile(rf"(?m)^\s*(?:二、)?{BRIEF}\s*$")
BRIEF_ANSWER_RE = re.compile(r"(?:答案要点|答)\s*[：:]")


def clean_text(value: str) -> str:
    value = value.replace("\u3000", " ").replace("\ufeff", "")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\s*\n\s*", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def normalize_chapter(value: str) -> str:
    value = clean_text(value).replace("导 论", "导论")
    value = re.sub(r"\s+(重要知识点|知识点和自测题).*$", "", value)
    value = re.sub(r"(章)(?=\S)", r"\1 ", value)
    value = value.replace("的 教育", "的教育").replace("祖国 完全", "祖国完全")
    return value


def chapter_order(value: str) -> int:
    if value == "导论":
        return 0

    numerals = {
        "一": 1,
        "二": 2,
        "三": 3,
        "四": 4,
        "五": 5,
        "六": 6,
        "七": 7,
        "八": 8,
        "九": 9,
        "十": 10,
    }
    match = re.search(rf"第([{CN_NUM}]+)章", value)
    if not match:
        return 999

    text = match.group(1)
    if text == "十":
        return 10
    if text.startswith("十"):
        return 10 + numerals.get(text[1:], 0)
    if text.endswith("十"):
        return numerals.get(text[0], 0) * 10
    if "十" in text:
        left, right = text.split("十", 1)
        return numerals.get(left, 1) * 10 + numerals.get(right, 0)
    return numerals.get(text, 999)


def normalize_answer(value: str) -> str:
    return "".join(sorted(re.sub(r"[^A-D]", "", value)))


def parse_answer_map(value: str) -> dict[int, str]:
    answers: dict[int, str] = {}
    value = (
        value.replace("．", ".")
        .replace("：", ":")
        .replace("、", ".")
        .replace("点击空白处查看答案", " ")
    )

    for match in re.finditer(r"(\d+)\s*-\s*(\d+)\s*[\.:]?\s*([A-D][A-D\s]*)", value):
        start = int(match.group(1))
        end = int(match.group(2))
        letters = re.sub(r"[^A-D]", "", match.group(3))
        if end >= start and len(letters) == end - start + 1:
            for number, answer in enumerate(letters, start=start):
                answers[number] = answer

    value = re.sub(r"\d+\s*-\s*\d+\s*[\.:]?\s*[A-D][A-D\s]*", " ", value)
    for match in re.finditer(r"(\d+)\s*[\.:]\s*([A-D](\s*[A-D])*)", value):
        answers[int(match.group(1))] = normalize_answer(match.group(2))

    return answers


def parse_options(block: str) -> tuple[str, dict[str, str]] | None:
    matches = list(OPTION_RE.finditer(block))
    if len(matches) < 4:
        return None

    options: dict[str, str] = {}
    for index, match in enumerate(matches):
        label = match.group(1)
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(block)
        option_text = block[start:end]
        option_text = re.split(rf"{REF}|{KNOWLEDGE}[：:]|答案[：:]", option_text)[0]
        options[label] = clean_text(option_text)

    stem = clean_text(block[: matches[0].start()])
    if not stem or any(not options.get(key) for key in "ABCD"):
        return None

    return stem, options


def question_id(question: dict[str, object]) -> str:
    payload: dict[str, object] = {
        "chapter": question["chapter"],
        "type": question["type"],
        "stem": question["stem"],
    }
    if question["type"] == "brief":
        payload["referenceAnswer"] = question["referenceAnswer"]
    else:
        payload["options"] = question["options"]
        payload["answer"] = question["answer"]
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return sha1(encoded.encode("utf-8")).hexdigest()[:12]


def extract_brief_questions(
    chapter: str,
    chapter_pages: list[tuple[int, str]],
    chapter_text: str,
) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    if chapter in EXCLUDED_BRIEF_CHAPTERS:
        return [], []

    questions: list[dict[str, object]] = []
    issues: list[dict[str, object]] = []
    markers = list(BRIEF_RE.finditer(chapter_text))
    for marker_index, marker in enumerate(markers):
        section_start = marker.end()
        section_end = markers[marker_index + 1].start() if marker_index + 1 < len(markers) else len(chapter_text)
        section_text = chapter_text[section_start:section_end]
        starts = list(QUESTION_RE.finditer(section_text))

        for question_index, question_marker in enumerate(starts):
            number = int(question_marker.group(1))
            block_start = question_marker.end()
            block_end = starts[question_index + 1].start() if question_index + 1 < len(starts) else len(section_text)
            raw_block = section_text[block_start:block_end]
            previous_pages = list(re.finditer(r"\[\[PAGE:(\d+)\]\]", section_text[: question_marker.start()]))
            source_page = int(previous_pages[-1].group(1)) if previous_pages else chapter_pages[0][0]
            block = re.sub(r"\[\[PAGE:\d+\]\]", " ", raw_block)
            answer_match = BRIEF_ANSWER_RE.search(block)
            if not answer_match:
                issues.append(
                    {
                        "chapter": chapter,
                        "type": "brief",
                        "number": number,
                        "reason": "brief_answer_not_found",
                        "sample": clean_text(block)[:160],
                    }
                )
                continue

            stem = clean_text(block[: answer_match.start()])
            reference_answer = clean_text(block[answer_match.end() :])
            if not stem or not reference_answer:
                issues.append(
                    {
                        "chapter": chapter,
                        "type": "brief",
                        "number": number,
                        "reason": "brief_content_incomplete",
                        "sample": clean_text(block)[:160],
                    }
                )
                continue

            question = {
                "chapter": chapter,
                "type": "brief",
                "number": number,
                "stem": stem,
                "referenceAnswer": reference_answer,
                "sourcePage": source_page,
            }
            question["id"] = question_id(question)
            questions.append(question)

    return questions, issues


def extract_questions(pdf_path: Path) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    reader = PdfReader(str(pdf_path))
    current_chapter = "导论"
    pages: list[tuple[str, int, str]] = []

    for page_number, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        heading_area = "\n".join(lines[:4])
        chapter_match = CHAPTER_RE.search(heading_area)
        if chapter_match:
            current_chapter = normalize_chapter(chapter_match.group(1))
        pages.append((current_chapter, page_number, text))

    by_chapter: dict[str, list[tuple[int, str]]] = {}
    for chapter, page_number, text in pages:
        by_chapter.setdefault(chapter, []).append((page_number, text))

    questions: list[dict[str, object]] = []
    issues: list[dict[str, object]] = []

    for chapter, chapter_pages in by_chapter.items():
        chapter_text = "\n".join(
            f"\n[[PAGE:{page_number}]]\n{text}"
            for page_number, text in chapter_pages
        )
        type_markers = list(TYPE_RE.finditer(chapter_text))

        for marker_index, marker in enumerate(type_markers):
            question_type = "single" if marker.group(3) == SINGLE else "multiple"
            start = marker.end()
            end = (
                type_markers[marker_index + 1].start()
                if marker_index + 1 < len(type_markers)
                else len(chapter_text)
            )
            section_text = chapter_text[start:end]
            stop_match = STOP_RE.search(section_text)
            if stop_match:
                section_text = section_text[: stop_match.start()]

            answer_map: dict[int, str] = {}
            question_text = section_text
            if section_text.count(REF) == 1:
                before_answers, after_answers = section_text.split(REF, 1)
                if len(before_answers) > 400 or len(list(QUESTION_RE.finditer(before_answers))) > 1:
                    question_text = before_answers
                    answer_map = parse_answer_map(after_answers)

            starts = list(QUESTION_RE.finditer(question_text))
            for question_index, question_marker in enumerate(starts):
                number = int(question_marker.group(1))
                block_start = question_marker.end()
                block_end = (
                    starts[question_index + 1].start()
                    if question_index + 1 < len(starts)
                    else len(question_text)
                )
                block = question_text[block_start:block_end]
                previous_pages = list(
                    re.finditer(r"\[\[PAGE:(\d+)\]\]", question_text[: question_marker.start()])
                )
                source_page = (
                    int(previous_pages[-1].group(1))
                    if previous_pages
                    else chapter_pages[0][0]
                )
                block = re.sub(r"\[\[PAGE:\d+\]\]", " ", block)
                inline_answer = INLINE_ANSWER_RE.search(block)
                answer = (
                    normalize_answer(inline_answer.group(1))
                    if inline_answer
                    else answer_map.get(number, "")
                )
                content = re.split(rf"{REF}|答案[：:]|{KNOWLEDGE}[：:]|答案要点[：:]", block)[0]
                parsed = parse_options(content)

                if not parsed:
                    issues.append(
                        {
                            "chapter": chapter,
                            "type": question_type,
                            "number": number,
                            "reason": "options_not_found",
                            "sample": clean_text(block)[:160],
                        }
                    )
                    continue
                if not answer:
                    issues.append(
                        {
                            "chapter": chapter,
                            "type": question_type,
                            "number": number,
                            "reason": "answer_not_found",
                            "sample": parsed[0][:160],
                        }
                    )
                    continue
                if question_type == "single" and len(answer) != 1:
                    issues.append(
                        {
                            "chapter": chapter,
                            "type": question_type,
                            "number": number,
                            "reason": "single_answer_not_unique",
                            "answer": answer,
                            "sample": parsed[0][:160],
                        }
                    )
                    continue

                stem, options = parsed
                question = {
                    "chapter": chapter,
                    "type": question_type,
                    "number": number,
                    "stem": stem,
                    "options": options,
                    "answer": answer,
                    "sourcePage": source_page,
                }
                question["id"] = question_id(question)
                questions.append(question)

        brief_questions, brief_issues = extract_brief_questions(chapter, chapter_pages, chapter_text)
        questions.extend(brief_questions)
        issues.extend(brief_issues)

    deduped: list[dict[str, object]] = []
    seen: set[tuple[object, ...]] = set()
    for question in questions:
        key = (
            question["chapter"],
            question["type"],
            question["stem"],
            question.get("referenceAnswer")
            if question["type"] == "brief"
            else (tuple(question["options"][key] for key in "ABCD"), question["answer"]),  # type: ignore[index]
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(question)

    deduped.sort(
        key=lambda question: (
            chapter_order(str(question["chapter"])),
            int(question["sourcePage"]),
            {"single": 0, "multiple": 1, "brief": 2}.get(str(question["type"]), 9),
            int(question["number"]),
        )
    )
    return deduped, issues


def main() -> int:
    pdf_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_PDF
    if not pdf_path.exists():
        print(f"PDF not found: {pdf_path}", file=sys.stderr)
        return 1

    questions, issues = extract_questions(pdf_path)
    chapters = []
    for chapter in sorted(
        dict.fromkeys(question["chapter"] for question in questions),
        key=lambda value: (chapter_order(str(value)), str(value)),
    ):
        chapter_questions = [question for question in questions if question["chapter"] == chapter]
        chapters.append(
            {
                "name": chapter,
                "count": len(chapter_questions),
                "single": sum(1 for question in chapter_questions if question["type"] == "single"),
                "multiple": sum(1 for question in chapter_questions if question["type"] == "multiple"),
                "brief": sum(1 for question in chapter_questions if question["type"] == "brief"),
            }
        )

    payload = {
        "source": str(pdf_path),
        "total": len(questions),
        "typeCounts": Counter(question["type"] for question in questions),
        "chapters": chapters,
        "questions": questions,
    }

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(
        "window.QUESTION_BANK = "
        + json.dumps(payload, ensure_ascii=False, indent=2)
        + ";\n",
        encoding="utf-8",
    )
    ISSUE_FILE.write_text(
        json.dumps(issues, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"Imported {len(questions)} questions into {OUT_FILE}")
    print(f"Chapters: {len(chapters)}")
    print(f"Issues written: {len(issues)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
