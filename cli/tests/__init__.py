import os

# Wide, uncolored output whatever terminal runs the tests. Set before teamflow_cli creates its consoles.
os.environ["COLUMNS"] = "200"
os.environ["NO_COLOR"] = "1"
os.environ.pop("TEAMFLOW_URL", None)
