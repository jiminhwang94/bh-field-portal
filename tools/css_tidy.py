"""CSS 덮어쓰기 정리 — **보이는 결과가 바뀌지 않는 것이 증명되는** 변경만 한다.

판마다(v3.23 · v3.28 · v3.29) 앞 규칙을 뒤에서 덮어쓰는 식으로 쌓여서, 같은 선택자가
여러 곳에 흩어져 있었다. 고칠 곳을 찾기 어렵고, 고쳐도 뒤에서 또 덮여 안 바뀐다.

두 가지만 한다.
  1. 죽은 선언 지우기 — 같은 선택자 · 같은 미디어 조건의 **나중 규칙**이 같은 속성을
     다시 정하면 앞의 것은 어느 요소에서도 이기지 못한다. 지운다.
  2. 뒤 규칙을 앞 규칙에 합치기 — 같은 선택자 · 같은 미디어 조건이고, **두 규칙 사이의
     어떤 규칙도 그 속성(또는 그 묶음: padding ↔ padding-left 등)을 정하지 않으면**
     선언을 앞으로 옮겨도 이기고 지는 관계가 그대로다. 옮긴다.

색 섞기(color-mix) 처럼 옛 브라우저가 못 읽는 값이 뒤에 있으면 앞 값이 대신 쓰이므로
그런 짝은 건드리지 않는다. 글자는 도려내기만 한다 — 줄 모양 · 주석은 그대로 둔다.

실행:  python tools/css_tidy.py web/css/base.css         (같은 자리에 쓴다 · v3.30 에서 한 파일이던 때 한 번 썼다)
       파일을 나눈 뒤에는 파일 하나 안에서만 본다 (파일 사이 덮어쓰기는 보지 않는다)
검증은 화면 검사가 한다: npx playwright test styles  (계산된 스타일이 기준과 같은지)
"""
import io
import re
import sys

NL = "\n"


# ───────────────────────────────────────────────────────────── 읽기

class Comment:
    def __init__(self, text):
        self.text = text


class Decl:
    def __init__(self, prop, value, important, span=None):
        self.prop, self.value, self.important = prop, value, important
        self.span = span            # 원래 본문 안 (시작, 끝) — 옮겨 온 선언은 None

    def text(self):
        return f"{self.prop}: {self.value}{' !important' if self.important else ''};"


class Rule:
    def __init__(self, selector, items, raw, body):
        self.selector, self.items, self.raw, self.body = selector, items, raw, body
        self.dirty = False

    @property
    def key(self):
        return re.sub(r"\s+", " ", self.selector.strip())

    def decls(self):
        return [d for d in self.items if isinstance(d, Decl)]


class Block:                       # @media / @supports — 안에 규칙이 있다
    def __init__(self, prelude, children):
        self.prelude, self.children = prelude, children


class Raw:                         # @keyframes · @font-face 등 — 건드리지 않는다
    def __init__(self, text):
        self.text = text


class Space:
    def __init__(self, text):
        self.text = text


def skip_string(s, i):
    q = s[i]
    j = i + 1
    while s[j] != q:
        j += 2 if s[j] == "\\" else 1
    return j + 1


def find_close(s, i):
    """s[i] == '{' 일 때 짝이 맞는 '}' 의 자리 (주석 · 문자열 무시)"""
    depth = 0
    while i < len(s):
        if s.startswith("/*", i):
            i = s.index("*/", i) + 2
            continue
        c = s[i]
        if c in "\"'":
            i = skip_string(s, i)
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    raise ValueError("괄호 짝이 맞지 않습니다")


IMPORTANT = re.compile(r"\s*!\s*important\s*$")


def parse_body(body):
    items, depth, i, start = [], 0, 0, None

    def flush(end):
        nonlocal start
        if start is None:
            return
        t = body[start:end].strip().rstrip(";").strip()
        if t:
            prop, _, value = t.partition(":")
            value = value.strip()
            imp = bool(IMPORTANT.search(value))
            value = IMPORTANT.sub("", value)
            items.append(Decl(prop.strip(), value, imp, (start, end)))
        start = None

    while i < len(body):
        if body.startswith("/*", i):
            j = body.index("*/", i) + 2
            if start is None:
                items.append(Comment(body[i:j]))
            i = j
            continue
        c = body[i]
        if start is None and not c.isspace() and c != ";":
            start = i
        if c in "\"'":
            i = skip_string(body, i)
            continue
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
        if c == ";" and depth == 0:
            flush(i + 1)
        i += 1
    flush(len(body))
    return items


def parse(s):
    nodes, i, n = [], 0, len(s)
    while i < n:
        m = re.match(r"\s+", s[i:])
        if m:
            nodes.append(Space(m.group(0)))
            i += len(m.group(0))
            continue
        if s.startswith("/*", i):
            j = s.index("*/", i) + 2
            nodes.append(Comment(s[i:j]))
            i = j
            continue
        brace = s.index("{", i)
        semi = s.find(";", i)
        if s[i] == "@" and 0 <= semi < brace:
            nodes.append(Raw(s[i:semi + 1]))
            i = semi + 1
            continue
        close = find_close(s, brace)
        head = s[i:brace]
        inner = s[brace + 1:close]
        if head.strip().startswith(("@media", "@supports")):
            nodes.append(Block(head, parse(inner)))
        elif head.strip().startswith("@"):
            nodes.append(Raw(s[i:close + 1]))
        else:
            nodes.append(Rule(head, parse_body(inner), s[i:close + 1], inner))
        i = close + 1
    return nodes


# ───────────────────────────────────────────────────────────── 쓰기

def render_rule(rule, indent):
    """바뀐 규칙도 원래 글자에서 도려내고 덧붙인다 (줄 모양 · 주석 유지)."""
    if not rule.dirty:
        return rule.raw
    body = rule.body
    alive = {d.span for d in rule.items if isinstance(d, Decl) and d.span}
    original = [d for d in parse_body(body) if isinstance(d, Decl)]
    out_lines, pos = [], 0
    for line in body.split(NL):
        a, b = pos, pos + len(line)
        pos = b + 1
        on_line = [d for d in original if a <= d.span[0] < b]
        if not on_line:
            out_lines.append(line)
            continue
        removed = [d for d in on_line if d.span not in alive]
        if len(removed) == len(on_line):
            continue                    # 선언이 다 빠진 줄은 같은 줄 주석까지 지운다
        text = line
        for d in sorted(removed, key=lambda d: -d.span[0]):
            x, y = d.span[0] - a, min(d.span[1], b) - a
            while y < len(text) and text[y] == " ":
                y += 1
            text = text[:x] + text[y:]
        out_lines.append(text)
    new_body = NL.join(out_lines)
    added = [d for d in rule.items if isinstance(d, Decl) and not d.span]
    if added:
        if NL in new_body:
            pad = indent + "  "
            new_body = new_body.rstrip() + "".join(NL + pad + d.text() for d in added) + NL + indent
        else:
            inner = new_body.strip()
            new_body = " " + (inner + " " if inner else "") + " ".join(d.text() for d in added) + " "
    if not any(isinstance(d, Decl) for d in parse_body(new_body)):
        return ""
    return rule.selector + "{" + new_body + "}"


def render(nodes, indent=""):
    out = []
    drop_trailing = False             # 지운 규칙 바로 뒤 같은 줄의 주석도 지운다
    for node in nodes:
        if isinstance(node, Space):
            if drop_trailing and NL not in node.text:
                continue
            drop_trailing = False
            out.append(node.text)
        elif isinstance(node, Comment):
            if drop_trailing:
                drop_trailing = False
                continue
            out.append(node.text)
        elif isinstance(node, Raw):
            drop_trailing = False
            out.append(node.text)
        elif isinstance(node, Rule):
            text = render_rule(node, indent) if node.decls() else ""
            drop_trailing = not text
            if text:
                out.append(text)
        elif isinstance(node, Block):
            drop_trailing = False
            body = render(node.children, indent + "  ")
            if re.sub(r"/\*.*?\*/", "", body, flags=re.S).strip():
                out.append(node.prelude + "{" + body + "}")
    text = "".join(out)
    text = re.sub(r"[ \t]+\n", NL, text)
    return re.sub(r"\n{3,}", NL + NL, text)


# ───────────────────────────────────────────────────────────── 고치기

SPECIAL = {
    "inset": "pos", "top": "pos", "right": "pos", "bottom": "pos", "left": "pos",
    "place-items": "align", "place-content": "align", "place-self": "align",
    "align-items": "align", "align-content": "align", "align-self": "align",
    "justify-items": "align", "justify-content": "align", "justify-self": "align",
    "gap": "gap", "row-gap": "gap", "column-gap": "gap", "grid-gap": "gap",
    "line-height": "font", "columns": "column", "all": "*",
}
RISKY = ("color-mix(", "oklch(", "oklab(", "lab(", "lch(", "-webkit-", "-moz-")


def family(prop):
    p = prop.lower()
    if p.startswith("--"):
        return p
    p = re.sub(r"^-(webkit|moz|ms)-", "", p)
    return SPECIAL.get(p, p.split("-")[0])


def flatten(nodes, ctx=(), out=None):
    if out is None:
        out = []
    for node in nodes:
        if isinstance(node, Rule):
            out.append((ctx, node))
        elif isinstance(node, Block):
            flatten(node.children, ctx + (re.sub(r"\s+", " ", node.prelude.strip()),), out)
    return out


def drop_dead(rules):
    """1. 나중 규칙(같은 선택자 · 같은 조건)이 다시 정한 속성은 앞에서 지운다."""
    changed = 0
    for i, (ctx, a) in enumerate(rules):
        later = [b for c, b in rules[i + 1:] if c == ctx and b.key == a.key]
        if not later:
            continue
        keep = []
        for d in a.items:
            if isinstance(d, Decl):
                over = [x for b in later for x in b.decls()
                        if x.prop == d.prop and (x.important or not d.important)]
                if over and not any(t in x.value for x in over for t in RISKY):
                    changed += 1
                    a.dirty = True
                    continue
            keep.append(d)
        a.items = keep
    return changed


def merge_forward(rules):
    """2. 사이에 그 속성 묶음을 정하는 규칙이 없으면 뒤 규칙의 선언을 앞 규칙으로 옮긴다."""
    changed = 0
    for i, (ctx, a) in enumerate(rules):
        if not a.decls():
            continue
        for j in range(i + 1, len(rules)):
            cb, b = rules[j]
            if cb != ctx or b.key != a.key or not b.decls():
                continue
            between = set()
            for _, r in rules[i + 1:j]:
                for d in r.decls():
                    between.add(family(d.prop))
            if "*" in between:
                continue
            moved = [d for d in b.decls() if family(d.prop) not in between and family(d.prop) != "*"]
            if not moved:
                continue
            for d in moved:
                a.items.append(Decl(d.prop, d.value, d.important))
            b.items = [d for d in b.items if d not in moved]
            a.dirty = b.dirty = True
            changed += len(moved)
    return changed


def tidy(text):
    nodes = parse(text)
    stats = {"죽은 선언": 0, "앞으로 합친 선언": 0}
    while True:
        rules = flatten(nodes)
        a = drop_dead(rules)
        b = merge_forward(rules)
        stats["죽은 선언"] += a
        stats["앞으로 합친 선언"] += b
        if not (a or b):
            break
    stats["없어진 규칙"] = sum(1 for _, r in flatten(nodes) if not r.decls())
    return render(nodes), stats


if __name__ == "__main__":
    path = sys.argv[1]
    src = io.open(path, encoding="utf-8").read()
    out, stats = tidy(src)
    for k, v in stats.items():
        print(f"{k}: {v}")
    print(f"줄 수: {src.count(NL)} → {out.count(NL)}")
    if "--dry" not in sys.argv:
        io.open(path, "w", encoding="utf-8", newline=NL).write(out)
