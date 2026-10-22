"""스타일 파일 전부를 index.html 의 <link> 차례대로 이어 붙여 읽는다 (검사용).

스타일은 5개 파일로 나뉘어 있고, 불러오는 차례가 곧 덮어쓰는 차례다.
검사는 그 차례 그대로 하나의 글자로 본다.
"""
import io
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def css_files():
    index = io.open(os.path.join(ROOT, "web", "index.html"), encoding="utf-8").read()
    return re.findall(r'<link rel="stylesheet" href="/css/([^"]+)"', index)


def all_css():
    return "\n".join(io.open(os.path.join(ROOT, "web", "css", name), encoding="utf-8").read()
                     for name in css_files())
