import urllib.request
import urllib.error

req = urllib.request.Request(
    'https://api.notion.com/v1/search',
    method='POST',
    headers={
        'Authorization': 'Bearer YOUR_NOTION_TOKEN',
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
    },
    data=b'{}'
)

try:
    print(urllib.request.urlopen(req).read().decode('utf-8'))
except urllib.error.HTTPError as e:
    print(e.code, e.reason, e.read().decode('utf-8'))
