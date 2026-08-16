import sys
import os
sys.path.append(os.getcwd())

from app.main import app

routes = [r.path for r in app.routes]
print("Found gmail routes:")
for r in routes:
    if "gmail" in r:
        print(r)
