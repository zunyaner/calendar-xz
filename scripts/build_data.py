#!/usr/bin/env python3
"""Extract calendar JSON, build company-2027.ics, generate PWA icons, verify counts."""
from __future__ import annotations

import json
import re
import sys
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from openpyxl import load_workbook
import sxtwl
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SRC = Path("/workspace/xlsx/calendar-Uml4O6")
XLSX = SRC / "2027年多功能日历模板.xlsx"
SHEEP = SRC / "sheep-dingwei.png"
DATA_OUT = ROOT / "data" / "calendar-data.json"
ICS_OUT = ROOT / "company-2027.ics"
TZ = timezone(timedelta(hours=8), name="CST")

# Excel / 全年总览 legend colors
COLORS = {
    "coral": "#E8735A",
    "coralDark": "#D45E46",
    "bg": "#FFF5F0",
    "国定": "#FFE97F",
    "休": "#FDE2E2",
    "年休": "#C6E0B4",
    "班": "#DCE6F1",
    "今天": "#FFD966",
    "周末": "#F8E8E3",
}

EXPECTED_COUNTS = {
    "星期假日": 104,
    "国定假日": 13,
    "年度休假日": 117,
    "年休假": 2,
    "出勤日": 246,
    "年度出勤日": 248,
}


def iso(d: date) -> str:
    return d.isoformat()


def as_date(v) -> date:
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    raise TypeError(v)


def short_name(name: str) -> str:
    base = name.split("（", 1)[0].strip()
    mapping = {
        "公司年会活动日": "公司年会",
        "年终盘点预定日": "年终盘点",
        "年终盘点调休": "年终盘点",
        "周六上班": "调班上班",
        "周日上班": "调班上班",
        "清明节": "清明",
        "劳动节": "劳动节",
        "端午节": "端午",
        "中秋节": "中秋",
        "国庆节": "国庆",
        "元旦": "元旦",
        "春节": "春节",
    }
    return mapping.get(base, base)


JQ = ['冬至','小寒','大寒','立春','雨水','惊蛰','春分','清明','谷雨','立夏','小满','芒种',
      '夏至','小暑','大暑','立秋','处暑','白露','秋分','寒露','霜降','立冬','小雪','大雪']
MN = ['正月','二月','三月','四月','五月','六月','七月','八月','九月','十月','冬月','腊月']
TRAD = {(1,1):"春节",(1,15):"元宵节",(2,2):"龙抬头",(3,3):"上巳节",(5,5):"端午节",
        (7,7):"七夕",(7,15):"中元节",(8,15):"中秋节",(9,9):"重阳节",(12,8):"腊八节",(12,23):"小年"}
SOLAR_FEST = {(1,1):"元旦",(2,14):"情人节",(3,8):"妇女节",(3,12):"植树节",(5,1):"劳动节",(5,4):"青年节",
         (6,1):"儿童节",(7,1):"建党节",(8,1):"建军节",(9,10):"教师节",(10,1):"国庆节",(12,25):"圣诞节"}


def dayname(ld: int) -> str:
    if ld == 10:
        return "初十"
    if ld == 20:
        return "二十"
    if ld == 30:
        return "三十"
    t = "一二三四五六七八九"
    if ld < 10:
        return "初" + t[ld - 1]
    if ld < 20:
        return "十" + t[ld - 11]
    return "廿" + t[ld - 21]


def lunar_record(d: date) -> dict:
    """Build a day record with sxtwl (Beijing civil date)."""
    s = sxtwl.fromSolar(d.year, d.month, d.day)
    lm, ld, leap = s.getLunarMonth(), s.getLunarDay(), s.isLunarLeap()
    lshow = ("闰" if leap else "") + MN[lm - 1] + dayname(ld)
    jq = JQ[s.getJieQi()] if s.hasJieQi() else None
    tr = None if leap else TRAD.get((lm, ld))
    nxt_d = d + timedelta(days=1)
    nxt = sxtwl.fromSolar(nxt_d.year, nxt_d.month, nxt_d.day)
    if nxt.getLunarMonth() == 1 and nxt.getLunarDay() == 1 and not nxt.isLunarLeap():
        tr = "除夕"
    so = SOLAR_FEST.get((d.month, d.day))
    disp = tr or so or jq or ((("闰" if leap else "") + MN[lm - 1]) if ld == 1 else dayname(ld))
    return {
        "date": iso(d),
        "weekday": d.weekday(),
        "weekdayName": "星期" + "一二三四五六日"[d.weekday()],
        "lunarMonth": int(lm),
        "lunarDay": int(ld),
        "lunarText": lshow,
        "solarTerm": jq,
        "traditionalFestival": tr,
        "gregorianFestival": so,
        "label": disp or "",
        "holiday": None,
        "kind": "工作",
        "companyEvents": [],
    }


# 2026年11、12月行事历调整（通知 / TCC 2026年度行事历执行案）。只列例外日期。
SRC_2026 = "2026年11、12月行事历调整通知"
HOLIDAYS_2026 = [
    {"date": "2026-11-21", "type": "班", "name": "周六上班（与11/30盘点日调班）", "short": "调班上班", "source": SRC_2026},
    {"date": "2026-11-29", "type": "休", "name": "年终盘点预定日", "short": "年终盘点", "source": SRC_2026},
    {"date": "2026-11-30", "type": "休", "name": "年终盘点预定日（与11/21调班）", "short": "年终盘点", "source": SRC_2026},
    {"date": "2026-12-01", "type": "休", "name": "年终盘点调休（与12/5调班）", "short": "年终盘点", "source": SRC_2026},
    {"date": "2026-12-05", "type": "班", "name": "周六上班（与12/1调休）", "short": "调班上班", "source": SRC_2026},
]
EVENTS_2026 = [
    {"date": "2026-11-29", "name": "年终盘点", "note": "调整后预定日"},
    {"date": "2026-11-30", "name": "年终盘点", "note": "与11/21调班"},
    {"date": "2026-12-01", "name": "年终盘点", "note": "调休，与12/5调班"},
]


def load_source():
    wb = load_workbook(XLSX, data_only=True)

    quotes = []
    for row in wb["名言库"].iter_rows(min_row=2, max_row=41, max_col=2, values_only=True):
        if row[0]:
            quotes.append({"text": str(row[0]).strip(), "from": str(row[1] or "佚名").strip()})

    holidays = []
    for row in wb["节假日设置"].iter_rows(min_row=4, max_row=40, max_col=4, values_only=True):
        if not row[0]:
            continue
        d, typ, name, src = row
        holidays.append({
            "date": iso(as_date(d)),
            "type": typ,
            "name": name,
            "short": short_name(name),
            "source": src or "公司行事历",
        })

    events = []
    ws = wb["节假日设置"]
    for row in ws.iter_rows(min_row=4, max_row=7, min_col=6, max_col=8, values_only=True):
        if not row[0]:
            continue
        events.append({
            "date": iso(as_date(row[0])),
            "name": str(row[1]).strip(),
            "note": (str(row[2]).strip() if row[2] else ""),
        })

    holidays.extend(HOLIDAYS_2026)
    events.extend(EVENTS_2026)

    days = {}
    for row in wb["日历数据"].iter_rows(min_row=2, max_row=397, values_only=True):
        if not row[0]:
            continue
        d = as_date(row[0])
        days[iso(d)] = {
            "date": iso(d),
            "weekday": d.weekday(),  # 0=Mon
            "weekdayName": row[1],
            "lunarMonth": int(row[2]) if row[2] is not None else None,
            "lunarDay": int(row[3]) if row[3] is not None else None,
            "lunarText": row[4] or "",
            "solarTerm": row[5] or None,
            "traditionalFestival": row[6] or None,
            "gregorianFestival": row[7] or None,
            "label": row[8] or "",
            "holiday": None,
            "kind": "工作",
            "companyEvents": [],
        }

    holiday_by_date = {h["date"]: h for h in holidays}
    events_by_date = defaultdict(list)
    for ev in events:
        events_by_date[ev["date"]].append(ev)

    start = date(2026, 11, 1)
    end = date(2027, 12, 31)
    d = start
    while d <= end:
        key = iso(d)
        if key not in days:
            days[key] = lunar_record(d)
        rec = days[key]
        h = holiday_by_date.get(key)
        if h:
            rec["holiday"] = h
            rec["kind"] = h["type"]
        elif d.weekday() >= 5:
            rec["kind"] = "周末"
        else:
            rec["kind"] = "工作"
        rec["companyEvents"] = events_by_date.get(key, [])
        d += timedelta(days=1)

    return quotes, holidays, events, days


def compute_counts(days: dict) -> dict:
    """Same formula as the Excel 节假日设置 sheet for 2027."""
    n_weekend = 0
    n_guoding = 0
    n_nianxiu = 0
    n_ban_weekend = 0
    n_weekday_rest = 0  # weekday 休 or 国定
    year_days = 0
    for key, rec in days.items():
        d = date.fromisoformat(key)
        if d.year != 2027:
            continue
        year_days += 1
        wd = d.weekday()
        typ = (rec.get("holiday") or {}).get("type")
        if wd >= 5:
            n_weekend += 1
            if typ == "班":
                n_ban_weekend += 1
        if typ == "国定":
            n_guoding += 1
        if typ == "年休":
            n_nianxiu += 1
        if wd < 5 and typ in ("休", "国定"):
            n_weekday_rest += 1

    annual_leave_days = n_weekend - n_ban_weekend + n_weekday_rest
    work_days = year_days - annual_leave_days - n_nianxiu
    counts = {
        "星期假日": n_weekend,
        "国定假日": n_guoding,
        "年度休假日": annual_leave_days,
        "年休假": n_nianxiu,
        "出勤日": work_days,
        "年度出勤日": work_days + n_nianxiu,
        "yearDays": year_days,
    }
    return counts


def fold_line(line: str) -> str:
    raw = line.encode("utf-8")
    parts = []
    first = True
    while raw:
        limit = 75 if first else 74
        if len(raw) <= limit:
            piece = raw
            raw = b""
        else:
            piece = raw[:limit]
            while piece and raw[len(piece):] and (raw[len(piece)] & 0xC0) == 0x80:
                piece = piece[:-1]
            raw = raw[len(piece):]
        text = piece.decode("utf-8")
        parts.append(text if first else " " + text)
        first = False
    return "\r\n".join(parts)


def ics_escape(text: str) -> str:
    return (
        text.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\n", "\\n")
    )


def build_holiday_blocks(holidays: list[dict], days: dict) -> list[dict]:
    """Merge consecutive rest days of the same family, expanding through default weekends."""
    families: dict[str, list[date]] = defaultdict(list)
    nianxiu_dates = set()
    notes_by_family: dict[str, list[str]] = defaultdict(list)
    types_by_date: dict[date, str] = {}

    for h in holidays:
        typ = h["type"]
        d = date.fromisoformat(h["date"])
        types_by_date[d] = typ
        if typ == "班":
            continue
        fam = h["short"]
        if typ == "年休":
            nianxiu_dates.add(d)
            # 年休 still belongs to the holiday family (春节)
            families[fam].append(d)
            notes_by_family[fam].append(f"{d.month}月{d.day}日为年休假（无年休假者休无薪假）")
        else:
            families[fam].append(d)
            # keep original name note if it mentions 调班/顺延
            if "调班" in (h["name"] or "") or "顺延" in (h["name"] or ""):
                notes_by_family[fam].append(h["name"])

    blocks = []
    for fam, dates in families.items():
        dates = sorted(set(dates))
        # Cluster dates that are consecutive or separated only by default weekends.
        # Do not fill every weekend between distant same-name events
        # (e.g. 2026 年终盘点 and 2027 年终盘点).
        clusters = []
        cur = [dates[0]]
        for d in dates[1:]:
            gap_ok = True
            x = cur[-1] + timedelta(days=1)
            while x < d:
                typ = (days.get(iso(x)) or {}).get("kind")
                if typ != "周末":
                    gap_ok = False
                    break
                x += timedelta(days=1)
            if gap_ok:
                cur.append(d)
            else:
                clusters.append(cur)
                cur = [d]
        clusters.append(cur)

        expanded = set()
        PUBLIC = {"元旦", "春节", "清明", "劳动节", "端午", "中秋", "国庆"}
        for cluster in clusters:
            block = set(cluster)
            changed = True
            while changed:
                changed = False
                lo, hi = min(block), max(block)
                d = lo
                while d <= hi:
                    typ = (days.get(iso(d)) or {}).get("kind")
                    if typ == "周末" and d not in block:
                        block.add(d)
                        changed = True
                    d += timedelta(days=1)
                nxt = hi + timedelta(days=1)
                typ = (days.get(iso(nxt)) or {}).get("kind")
                if typ == "周末":
                    block.add(nxt)
                    changed = True
                if fam in PUBLIC:
                    prev = lo - timedelta(days=1)
                    typ = (days.get(iso(prev)) or {}).get("kind")
                    if typ == "周末":
                        block.add(prev)
                        changed = True
            expanded.update(block)

        # split into contiguous ranges
        ordered = sorted(expanded)
        range_start = ordered[0]
        prev = ordered[0]
        ranges = []
        for d in ordered[1:]:
            if d == prev + timedelta(days=1):
                prev = d
            else:
                ranges.append((range_start, prev))
                range_start = d
                prev = d
        ranges.append((range_start, prev))

        note_parts = []
        nx = sorted(x for x in nianxiu_dates if range_start <= x <= prev or any(a <= x <= b for a, b in ranges))
        # recompute nianxiu in all ranges
        nx = sorted({x for a, b in ranges for x in nianxiu_dates if a <= x <= b})
        if nx:
            days_zh = "、".join(f"{x.month}月{x.day}日" for x in nx)
            note_parts.append(f"其中{days_zh}为年休假（无年休假者休无薪假）")
        # unique other notes
        seen = set()
        for n in notes_by_family[fam]:
            if "年休" in n:
                continue
            if n not in seen:
                seen.add(n)
                note_parts.append(n)

        for a, b in ranges:
            title = f"休 · {fam}"
            if all(types_by_date.get(date.fromordinal(i)) == "年休"
                   for i in range(a.toordinal(), b.toordinal() + 1)
                   if date.fromordinal(i) in types_by_date):
                # range is only 年休 (shouldn't happen if we merged 春节)
                title = "年休" if fam == "春节" and a in nianxiu_dates and b in nianxiu_dates and (b - a).days <= 1 and not any(
                    date.fromordinal(i) not in nianxiu_dates for i in range(a.toordinal(), b.toordinal() + 1)
                ) else title
            blocks.append({
                "kind": "holiday",
                "family": fam,
                "start": a,
                "end": b,
                "title": title,
                "note": "。".join(note_parts),
            })
    return blocks


def alarm_utc(day: date, hour_local: int = 20) -> datetime:
    """Previous evening `hour_local` in Asia/Shanghai, as UTC datetime."""
    prev = datetime(day.year, day.month, day.day, hour_local, 0, 0, tzinfo=TZ) - timedelta(days=1)
    return prev.astimezone(timezone.utc)


def build_ics(holidays: list[dict], events: list[dict], days: dict, stamp: datetime) -> str:
    blocks = build_holiday_blocks(holidays, days)
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//2027日历//CN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        "X-WR-CALNAME:膳魔师行事历 2026.11–2027",
        "X-WR-TIMEZONE:Asia/Shanghai",
        "X-WR-CALDESC:膳魔师(中国)家庭制品有限公司行事历（2026年11月至2027年）。2026年11、12月按调整通知：年终盘点11/29–12/1，11/21与12/5调班上班。2027年终盘点仍为12/30–31。优秀员工日如遇节假日顺延；旅游日待定。订阅日历在 iPhone 上可能不会触发提醒。",
        "BEGIN:VTIMEZONE",
        "TZID:Asia/Shanghai",
        "X-LIC-LOCATION:Asia/Shanghai",
        "BEGIN:STANDARD",
        "TZOFFSETFROM:+0800",
        "TZOFFSETTO:+0800",
        "TZNAME:CST",
        "DTSTART:19700101T000000",
        "END:STANDARD",
        "END:VTIMEZONE",
    ]

    def add_event(uid: str, start: date, end_inclusive: date, summary: str,
                  description: str, alarm_text: str | None):
        # DTEND is exclusive
        end_ex = end_inclusive + timedelta(days=1)
        lines.append("BEGIN:VEVENT")
        lines.append(f"UID:{uid}")
        lines.append(f"DTSTAMP:{stamp.strftime('%Y%m%dT%H%M%SZ')}")
        lines.append(f"DTSTART;VALUE=DATE:{start.strftime('%Y%m%d')}")
        lines.append(f"DTEND;VALUE=DATE:{end_ex.strftime('%Y%m%d')}")
        lines.append("SUMMARY:" + ics_escape(summary))
        if description:
            lines.append("DESCRIPTION:" + ics_escape(description))
        lines.append("TRANSP:TRANSPARENT")
        lines.append("STATUS:CONFIRMED")
        if alarm_text:
            trig = alarm_utc(start, 20)
            lines.append("BEGIN:VALARM")
            lines.append(f"ACTION:DISPLAY")
            lines.append("DESCRIPTION:" + ics_escape(alarm_text))
            lines.append(f"TRIGGER;VALUE=DATE-TIME:{trig.strftime('%Y%m%dT%H%M%SZ')}")
            lines.append("END:VALARM")
        lines.append("END:VEVENT")

    # holiday blocks
    for b in sorted(blocks, key=lambda x: x["start"]):
        uid = f"holiday-{b['start'].strftime('%Y%m%d')}-{b['end'].strftime('%Y%m%d')}-{b['family']}@zunyaner.github.io"
        desc = b["note"] or b["title"]
        if b["start"] != b["end"]:
            desc = f"{b['start'].month}月{b['start'].day}日–{b['end'].month}月{b['end'].day}日。{desc}".rstrip("。")
        alarm = f"明天开始休息：{b['family']}"
        add_event(uid, b["start"], b["end"], b["title"], desc, alarm)

    # 班 days, each separate
    for h in holidays:
        if h["type"] != "班":
            continue
        d = date.fromisoformat(h["date"])
        uid = f"workday-{d.strftime('%Y%m%d')}@zunyaner.github.io"
        add_event(
            uid, d, d, "调班上班",
            h["name"],
            "明天调班上班",
        )

    # Company events that are not already the sole meaning of a rest block.
    # 公司年会 / 年终盘点 already appear as 休 · 公司年会 / 休 · 年终盘点.
    # 优秀员工日 is on a 劳动节 rest day — add a distinct event with the顺延 note.
    for ev in events:
        if ev["name"] == "优秀员工日":
            d = date.fromisoformat(ev["date"])
            uid = f"event-{d.strftime('%Y%m%d')}-优秀员工日@zunyaner.github.io"
            note = ev["note"] or "如遇节假日活动顺延"
            add_event(
                uid, d, d, "优秀员工日",
                f"{note}。日期按行事历暂记在 5 月 5 日，实际日期可能顺延。",
                "明天：优秀员工日（如遇节假日活动顺延）",
            )

    lines.append("END:VCALENDAR")
    # fold and join with CRLF; ensure file ends with CRLF
    folded = []
    for line in lines:
        folded.append(fold_line(line) if not line.startswith("BEGIN:") and not line.startswith("END:") and len(line.encode()) > 75 else (fold_line(line) if len(line.encode()) > 75 else line))
    return "\r\n".join(folded) + "\r\n"


def validate_ics(path: Path, holidays: list[dict], events: list[dict]):
    from icalendar import Calendar

    raw = path.read_bytes()
    assert raw.endswith(b"\r\n"), "ICS must end with CRLF"
    assert b"\r\n" in raw and b"\n" in raw
    # no bare LF (except as part of CRLF)
    assert b"\n" == b"\n"
    text = raw.replace(b"\r\n", b"")
    assert b"\r" not in text and b"\n" not in text, "found bare CR or LF"

    # line length: each physical line <= 75 octets, continuation starts with space
    for i, pl in enumerate(raw.split(b"\r\n")[:-1], 1):
        assert len(pl) <= 75, f"line {i} is {len(pl)} octets: {pl[:80]!r}"

    cal = Calendar.from_ical(raw)
    name = str(cal.get("X-WR-CALNAME"))
    assert name == "膳魔师行事历 2026.11–2027", name
    assert str(cal.get("X-WR-TIMEZONE")) == "Asia/Shanghai"

    vevents = list(cal.walk("VEVENT"))
    summaries = [str(e.get("SUMMARY")) for e in vevents]
    # 8 班 days in 2027 + 11/21 and 12/5 in 2026
    ban = [e for e in vevents if str(e.get("SUMMARY")) == "调班上班"]
    assert len(ban) == 10, f"expected 10 班 events, got {len(ban)}"
    for e in ban:
        alarms = list(e.walk("VALARM"))
        assert alarms, "班 event missing VALARM"
        desc = str(alarms[0].get("DESCRIPTION"))
        assert "明天调班上班" in desc

    # holiday blocks should have alarms
    hol = [e for e in vevents if str(e.get("SUMMARY")).startswith("休 · ")]
    assert hol, "no holiday blocks"
    for e in hol:
        alarms = list(e.walk("VALARM"))
        assert alarms, f"missing alarm on {e.get('SUMMARY')}"

    # 春节 should be 2/3–2/14 (DTEND exclusive 2/15)
    chunjie = [e for e in vevents if "春节" in str(e.get("SUMMARY"))]
    assert chunjie, "missing 春节"
    # may be one block
    cj = chunjie[0]
    ds = cj.get("DTSTART").dt
    de = cj.get("DTEND").dt
    assert ds == date(2027, 2, 3), ds
    assert de == date(2027, 2, 15), de  # exclusive

    # 优秀员工日
    assert any("优秀员工日" == s for s in summaries), summaries

    # 劳动节 5/1–5/5
    labor = [e for e in vevents if "劳动节" in str(e.get("SUMMARY"))]
    assert labor
    assert labor[0].get("DTSTART").dt == date(2027, 5, 1)
    assert labor[0].get("DTEND").dt == date(2027, 5, 6)

    # 国庆 10/1–10/7
    nd = [e for e in vevents if "国庆" in str(e.get("SUMMARY"))]
    assert nd
    assert nd[0].get("DTSTART").dt == date(2027, 10, 1)
    assert nd[0].get("DTEND").dt == date(2027, 10, 8)

    # 2026 年终盘点 11/29–12/1 (exclusive end 12/2); 2027 盘点 unchanged 12/30–31
    pandian = [e for e in vevents if "年终盘点" in str(e.get("SUMMARY"))]
    assert len(pandian) == 2, [ (e.get("DTSTART").dt, e.get("DTEND").dt) for e in pandian ]
    pandian = sorted(pandian, key=lambda e: e.get("DTSTART").dt)
    assert pandian[0].get("DTSTART").dt == date(2026, 11, 29), pandian[0].get("DTSTART").dt
    assert pandian[0].get("DTEND").dt == date(2026, 12, 2), pandian[0].get("DTEND").dt
    assert pandian[1].get("DTSTART").dt == date(2027, 12, 30), pandian[1].get("DTSTART").dt
    assert pandian[1].get("DTEND").dt == date(2028, 1, 1), pandian[1].get("DTEND").dt
    ban_starts = {e.get("DTSTART").dt for e in ban}
    assert date(2026, 11, 21) in ban_starts and date(2026, 12, 5) in ban_starts, ban_starts

    print(f"ICS validated: {len(vevents)} VEVENTs, {len(ban)} 班, {len(hol)} holiday blocks")
    for e in sorted(vevents, key=lambda x: x.get("DTSTART").dt if not isinstance(x.get("DTSTART").dt, datetime) else x.get("DTSTART").dt.date()):
        ds = e.get("DTSTART").dt
        de = e.get("DTEND").dt
        end_incl = de - timedelta(days=1) if de else ds
        span = f"{ds}" if ds == end_incl else f"{ds}–{end_incl}"
        print(f"  {span}  {e.get('SUMMARY')}")
    return len(vevents)


def make_icons():
    sheep = Image.open(SHEEP).convert("RGBA")
    # drop near-cream background to transparent-ish, keep the illustration
    pix = sheep.getdata()
    new = []
    for r, g, b, a in pix:
        # cream background around 255,248,241
        if r > 245 and g > 235 and b > 225:
            new.append((r, g, b, 0))
        else:
            new.append((r, g, b, a))
    sheep.putdata(new)

    # tight crop
    bbox = sheep.getbbox()
    sheep = sheep.crop(bbox)

    out_dir = ROOT / "icons"
    out_dir.mkdir(exist_ok=True)

    # save a compact illustration for the web app header
    header = Image.new("RGBA", (720, 524), (255, 245, 240, 255))
    # fit sheep
    s = sheep.copy()
    s.thumbnail((640, 460), Image.Resampling.LANCZOS)
    hx = (720 - s.size[0]) // 2
    hy = (524 - s.size[1]) // 2
    header.paste(s, (hx, hy), s)
    header.convert("RGB").save(out_dir / "sheep.png", "PNG", optimize=True)

    def icon(size: int, path: Path, maskable=True):
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        # rounded coral square
        pad = 0
        radius = int(size * 0.22)
        body = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        d = ImageDraw.Draw(body)
        d.rounded_rectangle((pad, pad, size - 1 - pad, size - 1 - pad), radius=radius, fill=(232, 115, 90, 255))
        img = body
        # inner cream circle-ish card then sheep
        inner_pad = int(size * 0.14) if maskable else int(size * 0.10)
        box = size - inner_pad * 2
        card = Image.new("RGBA", (box, box), (0, 0, 0, 0))
        cd = ImageDraw.Draw(card)
        cd.rounded_rectangle((0, 0, box - 1, box - 1), radius=int(box * 0.22), fill=(255, 248, 241, 255))
        s2 = sheep.copy()
        s2.thumbnail((int(box * 0.86), int(box * 0.86)), Image.Resampling.LANCZOS)
        cx = (box - s2.size[0]) // 2
        cy = (box - s2.size[1]) // 2 + int(box * 0.02)
        card.paste(s2, (cx, cy), s2)
        img.paste(card, (inner_pad, inner_pad), card)
        img.convert("RGBA").save(path, "PNG", optimize=True)

    icon(180, out_dir / "apple-touch-icon.png", maskable=False)
    icon(180, ROOT / "apple-touch-icon.png", maskable=False)
    icon(192, out_dir / "icon-192.png", maskable=True)
    icon(512, out_dir / "icon-512.png", maskable=True)
    print("icons written")


def main():
    quotes, holidays, events, days = load_source()
    counts = compute_counts(days)
    match = {k: counts[k] == EXPECTED_COUNTS[k] for k in EXPECTED_COUNTS}
    all_ok = all(match.values())
    print("COUNT CHECK")
    for k, exp in EXPECTED_COUNTS.items():
        got = counts[k]
        flag = "OK" if got == exp else "MISMATCH"
        print(f"  {k}: computed={got} company={exp} {flag}")
    if not all_ok:
        print("ERROR: counts do not match company calendar", file=sys.stderr)
        sys.exit(1)
    assert len(quotes) == 40, len(quotes)
    assert len(holidays) == 42, len(holidays)  # 37 in 2027 + 5 in 2026-11/12

    stamp = datetime.now(timezone.utc).replace(microsecond=0)
    payload = {
        "meta": {
            "title": "2027日历",
            "timezone": "Asia/Shanghai",
            "range": {"start": "2026-11-01", "end": "2027-12-31"},
            "yearOverview": 2027,
            "weekStart": 1,
            "builtAt": stamp.isoformat().replace("+00:00", "Z"),
            "source": "膳魔师(中国)家庭制品有限公司《2027年度行事历日程计划表（执行案）》",
            "notes": [
                "优秀员工日行事历印在 5 月 5 日，如遇节假日活动顺延（5 月 5 日为劳动节休息日），实际日期可能后延。",
                "旅游日将根据订单实际状况待定，确定后会再更新。",
                "2026 年 11、12 月按《2026年11、12月行事历调整通知》：年终盘点为 11 月 29 日–12 月 1 日，11 月 21 日、12 月 5 日调班上班；12 月 12 日、19 日恢复正常休息，12 月 30 日、31 日恢复正常上班。",
                "2027 年年终盘点 12 月 30 日、31 日仍按 2027 年度行事历，不受 2026 年调整影响。",
            ],
            "counts": {k: counts[k] for k in EXPECTED_COUNTS},
            "countsMatch": True,
        },
        "colors": COLORS,
        "quotes": quotes,
        "holidays": holidays,
        "events": events,
        "days": days,
    }
    DATA_OUT.parent.mkdir(parents=True, exist_ok=True)
    DATA_OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {DATA_OUT} ({DATA_OUT.stat().st_size} bytes), days={len(days)}, quotes={len(quotes)}")

    ics = build_ics(holidays, events, days, stamp)
    ICS_OUT.write_bytes(ics.encode("utf-8"))
    print(f"wrote {ICS_OUT} ({ICS_OUT.stat().st_size} bytes)")
    validate_ics(ICS_OUT, holidays, events)
    print("DONE")


if __name__ == "__main__":
    main()
