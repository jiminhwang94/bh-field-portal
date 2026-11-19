"""검사용 소스 읽기 — 파일 위치 · 줄 모양에 묶이지 않게 (43).

예전 검사는 "이 파일에 이 글자가 그대로 있다" 를 봤다. 그래서 지역 이름을 바꾸거나,
줄을 다시 맞추거나, 함수를 다른 파일로 옮기거나, 큰 파일을 나누기만 해도 깨졌다.
여기서는 화면 코드 · 스타일 · Apps Script 를 **통째로** 읽고, 느슨하게 찾는다.

  JS    web/js 아래 모든 .js (주석은 뺀다)
  CSS   web/css 아래 모든 .css (주석은 뺀다)
  GS    저장소 안의 모든 .gs (나눠도 함께 읽는다 · 주석은 뺀다)
  HTML  web/index.html      SW  web/sw.js

찾는 법
  has(snippet, where)      공백 · 줄바꿈 · 따옴표 종류를 따지지 않고 그 조각이 있는지
  has_re(pattern, where)   정규식 (주석 뺀 원문에서)
  defines(name, where)     함수 · 상수 이름이 어딘가에 정의돼 있는지
  calls(name, where)       그 이름을 부르는 곳들의 인자 글자 (정의는 뺀다)
  body(name, where)        그 함수(또는 상수) 정의의 본문 — 괄호를 맞춰 잘라 낸다
  module_of(name)          그 이름을 정의한 .js 파일(들)의 내용 — "그 일을 맡은 모듈"
  css_decls(selector)      그 선택자에 걸린 선언들 {속성: [값…]} — 어느 파일 · 어느 묶음이든
"""
import io
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
_SKIP_DIRS = {".git", "node_modules", ".claude", "android", "backups", "data", "test-results",
              "playwright-report", "tests"}


def read(*parts):
    return io.open(os.path.join(ROOT, *parts), encoding="utf-8").read()


# ───────────────────────────────────────────── 주석 빼기
_REGEX_BEFORE = set("(,=:[!&|?{};+-*%<>~^")
_REGEX_WORDS = {"return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw",
                "instanceof", "yield", "await"}


def strip_js_comments(src):
    """JS(.gs 포함) 에서 주석만 뺀다. 문자열 · 템플릿 · 정규식 안의 // 는 그대로 둔다."""
    out = []
    i, n = 0, len(src)
    tmpl = []          # 템플릿의 ${ 를 열 때의 괄호 깊이
    depth = 0
    last = ""          # 마지막 의미 있는 글자 (정규식인지 나눗셈인지 가리려고)
    word = ""          # 마지막 낱말

    def scan_template(j):
        """j 는 템플릿 글자 안. 끝(`) 또는 ${ 까지 간다. (끝 위치, ${ 로 멈췄는지)"""
        while j < n:
            ch = src[j]
            if ch == "\\":
                j += 2
                continue
            if ch == "`":
                return j + 1, False
            if ch == "$" and j + 1 < n and src[j + 1] == "{":
                return j + 2, True
            j += 1
        return n, False

    while i < n:
        c = src[i]
        if c in "'\"":
            j = i + 1
            while j < n and src[j] != c and src[j] != "\n":
                j += 2 if src[j] == "\\" else 1
            out.append(src[i:j + 1])
            i = j + 1
            last, word = c, ""
            continue
        if c == "`":
            j, opened = scan_template(i + 1)
            out.append(src[i:j])
            i = j
            if opened:
                tmpl.append(depth)
                depth += 1
                last, word = "{", ""
            else:
                last, word = "`", ""
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "/":
            j = src.find("\n", i)
            i = n if j < 0 else j
            continue
        if c == "/" and i + 1 < n and src[i + 1] == "*":
            j = src.find("*/", i + 2)
            i = n if j < 0 else j + 2
            out.append(" ")
            continue
        if c == "/" and (last == "" or last in _REGEX_BEFORE or word in _REGEX_WORDS):
            j = i + 1
            in_class = False
            while j < n and src[j] != "\n":
                ch = src[j]
                if ch == "\\":
                    j += 2
                    continue
                if ch == "[":
                    in_class = True
                elif ch == "]":
                    in_class = False
                elif ch == "/" and not in_class:
                    break
                j += 1
            j += 1
            while j < n and (src[j].isalnum()):
                j += 1
            out.append(src[i:j])
            i = j
            last, word = "/", ""
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if tmpl and depth == tmpl[-1]:
                tmpl.pop()
                j, opened = scan_template(i + 1)
                out.append(src[i:j])
                i = j
                if opened:
                    tmpl.append(depth)
                    depth += 1
                    last, word = "{", ""
                else:
                    last, word = "`", ""
                continue
        out.append(c)
        if c.isalnum() or c in "_$":
            word = (word + c) if (last and (last.isalnum() or last in "_$")) else c
            last = c
        elif not c.isspace():
            last, word = c, ""
        i += 1
    return "".join(out)


def strip_css_comments(src):
    return re.sub(r"/\*.*?\*/", " ", src, flags=re.S)


# ───────────────────────────────────────────── 읽기
def _walk(base, ext):
    found = []
    for root, dirs, files in os.walk(base):
        dirs[:] = sorted(d for d in dirs if d not in _SKIP_DIRS)
        for name in sorted(files):
            if name.endswith(ext):
                found.append(os.path.join(root, name))
    return found


def _rel(path):
    return os.path.relpath(path, ROOT).replace(os.sep, "/")


JS_FILES = {_rel(p): strip_js_comments(io.open(p, encoding="utf-8").read())
            for p in _walk(os.path.join(WEB, "js"), ".js")}
CSS_FILES = {_rel(p): strip_css_comments(io.open(p, encoding="utf-8").read())
             for p in _walk(os.path.join(WEB, "css"), ".css")}
GS_FILES = {_rel(p): strip_js_comments(io.open(p, encoding="utf-8").read())
            for p in _walk(ROOT, ".gs")}

JS = "\n".join(JS_FILES.values())
CSS = "\n".join(CSS_FILES.values())
GS = "\n".join(GS_FILES.values())
HTML = read("web", "index.html")
SW = strip_js_comments(read("web", "sw.js"))

SOURCES = {"js": JS, "css": CSS, "gs": GS, "html": HTML, "sw": SW, "web": JS + "\n" + HTML}


def source(where):
    """where 는 'js' · 'css' · 'gs' · 'html' · 'sw' · 'web'(js+html) 이거나 글자 그 자체."""
    return SOURCES[where] if where in SOURCES else where


# ───────────────────────────────────────────── 찾기
def squash(text):
    """공백을 모두 빼고 따옴표를 하나로 — 줄 맞춤 · 따옴표 종류가 달라도 같은 것으로 본다."""
    return re.sub(r"\s+", "", text).replace('"', "'").replace("`", "'")


_SQUASHED = {}


def _squashed(where):
    if isinstance(where, str) and where in SOURCES:
        if where not in _SQUASHED:
            _SQUASHED[where] = squash(SOURCES[where])
        return _SQUASHED[where]
    return squash(where)


def has(snippet, where="js"):
    """그 코드 조각이 있다 (공백 · 줄바꿈 · 따옴표 종류 무시)."""
    return squash(snippet) in _squashed(where)


def count(snippet, where="js"):
    return _squashed(where).count(squash(snippet))


def has_re(pattern, where="js", flags=re.S):
    return re.search(pattern, source(where), flags) is not None


_DEF = r"(?:function\s*\*?\s*{n}\s*\(|(?:const|let|var)\s+{n}\s*=|\b{n}\s*:\s*(?:async\s*)?(?:function|\())"


def defines(name, where="js"):
    """함수 · 상수가 어딘가에 정의돼 있다 (function X( · const X = · let X = · var X =)."""
    return re.search(_DEF.format(n=re.escape(name)), source(where)) is not None


def _match_close(text, start, open_ch, close_ch):
    """text[start] 가 여는 괄호. 짝이 맞는 닫는 괄호 다음 위치. 문자열 안은 건너뛴다."""
    depth = 0
    i, n = start, len(text)
    while i < n:
        c = text[i]
        if c in "'\"`":
            j = i + 1
            while j < n and text[j] != c:
                if text[j] == "\\":
                    j += 1
                elif c == "`" and text[j] == "$" and j + 1 < n and text[j + 1] == "{":
                    j = _match_close(text, j + 1, "{", "}") - 1
                j += 1
            i = j + 1
            continue
        if c == open_ch:
            depth += 1
        elif c == close_ch:
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return n


def calls(name, where="js"):
    """name( … ) 로 부르는 곳마다 괄호 안 글자. 정의(function name( )는 뺀다."""
    text = source(where)
    out = []
    for m in re.finditer(r"(?<![\w$])%s\s*\(" % re.escape(name), text):
        before = text[max(0, m.start() - 20):m.start()]
        if re.search(r"function\s*\*?\s*$", before):
            continue
        start = m.end() - 1
        out.append(text[start + 1:_match_close(text, start, "(", ")") - 1])
    return out


def body(name, where="js"):
    """정의된 함수(또는 const X = …)의 본문 글자. 여러 곳이면 이어 붙인다. 없으면 ''."""
    text = source(where)
    out = []
    for m in re.finditer(_DEF.format(n=re.escape(name)), text):
        rest = text[m.end():].lstrip()
        if m.group(0).rstrip().endswith("=") and rest[:1] in "[{":
            # const X = [ … ]; · const X = { … }; — 값 덩어리를 통째로
            start = text.index(rest[0], m.end())
            pair = "[]" if rest[0] == "[" else "{}"
            out.append(text[m.start():_match_close(text, start, pair[0], pair[1])])
            continue
        brace = text.find("{", m.end())
        arrow_end = text.find(";", m.end())
        # const X = 값; · const X = () => expr; 처럼 중괄호 없는 한 줄짜리
        if brace < 0 or 0 <= arrow_end < brace:
            out.append(text[m.start():arrow_end + 1])
            continue
        # 인자 목록의 { a = 1 } 같은 구조 분해를 본문으로 착각하지 않게 — ( … ) 를 먼저 건너뛴다
        paren = text.find("(", m.end() - 1)
        if 0 <= paren < brace:
            after = _match_close(text, paren, "(", ")")
            brace = text.find("{", after)
        out.append(text[m.start():_match_close(text, brace, "{", "}")])
    return "\n".join(out)


def module_of(name):
    """그 이름을 정의한 .js 파일(들)의 내용 — 파일을 옮기거나 나눠도 그 일을 맡은 곳을 찾는다."""
    return "\n".join(src for src in JS_FILES.values() if defines(name, src))


# ───────────────────────────────────────────── CSS
def _css_rules(text):
    """(선택자 목록, 선언 글자) 를 모두 — @media 안쪽까지."""
    rules = []
    i, n = 0, len(text)
    while i < n:
        brace = text.find("{", i)
        if brace < 0:
            break
        head = text[i:brace].split(";")[-1].strip()      # 앞의 @import …; 는 떼어 낸다
        end = _match_close(text, brace, "{", "}")
        inner = text[brace + 1:end - 1]
        if head.startswith("@"):
            if "{" in inner:
                rules.extend(_css_rules(inner))
        else:
            sels = [_norm_sel(s) for s in head.split(",")]
            rules.append((sels, inner))
        i = end
    return rules


_RULES = None


def _norm_sel(sel):
    return re.sub(r"\s+", " ", re.sub(r"\s*([>+~])\s*", r" \1 ", sel)).strip()


def css_decls(selector, where="css"):
    """그 선택자(정확히 같은 것)에 걸린 선언 {속성: [값…]}. 파일 · 묶음 · 쉼표 목록 어디든."""
    global _RULES
    rules = _css_rules(source(where)) if where != "css" else (_RULES or _css_rules(CSS))
    if where == "css":
        _RULES = rules
    want = _norm_sel(selector)
    out = {}
    for sels, inner in rules:
        if want in sels:
            for decl in inner.split(";"):
                if ":" in decl:
                    prop, val = decl.split(":", 1)
                    out.setdefault(prop.strip(), []).append(re.sub(r"\s+", " ", val).strip())
    return out


def css_has(selector, prop, value_pattern=None, where="css"):
    """그 선택자에 그 속성이 있다 (값 정규식을 주면 값도 맞아야)."""
    vals = css_decls(selector, where).get(prop, [])
    if value_pattern is None:
        return bool(vals)
    return any(re.search(value_pattern, v) for v in vals)


def has_selector(selector, where="css"):
    """그 선택자로 시작하는 규칙이 어딘가에 있다 (.a 는 .a · .a:hover · .a .b 모두)."""
    return re.search(r"(^|[\s,}>+~])%s(?![\w-])" % re.escape(selector), source(where)) is not None


def module_with(token):
    """그 글자(공백 · 따옴표 무시)가 든 .js 파일(들)의 내용 — 이름을 몰라도 그 일을 맡은 곳을 찾는다."""
    return "\n".join(src for src in JS_FILES.values() if has(token, src))
