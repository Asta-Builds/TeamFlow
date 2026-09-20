"""
Untrusted Text Sanitization for Markdown Comments.

Prevents prompt injection / card forgery in TeamFlow comment streams by neutralizing
fences and UI card injection markers from executor-provided output.
"""

import re
from typing import Optional


def neutralize_untrusted_markdown(text: Optional[str]) -> str:
    """
    Neutralizes untrusted text (e.g. from model code output, build steps, CI logs)
    before embedding it inside markdown comments.

    - Replaces every run of 3 or more backticks with the same number of single quotes ('),
      so the text cannot prematurely close or forge code fences.
    - Removes the markers 'json:teamflow-' and 'json:generative-' (case-insensitive)
      wherever they appear, preventing generative UI card injection.
    - Leaves everything else unchanged.
    """
    if not text:
        return ""
    if not isinstance(text, str):
        text = str(text)

    # 1. Replace every run of 3 or more backticks with the same number of single quotes
    res = re.sub(r'`{3,}', lambda m: "'" * len(m.group(0)), text)

    # 2. Remove markers json:teamflow- and json:generative- (case-insensitive)
    res = re.sub(r'(?i)json:(?:teamflow|generative)-', '', res)

    return res
