import uiautomator2 as u2
import time
import xml.etree.ElementTree as ET
print('1. Connecting to phone...')
d = u2.connect()
print('2. Connected. Waking screen...')
d.screen_on()
d.press('home')
time.sleep(1)
print('3. Opening Indeed search...')
d.shell(['am', 'start', '-a', 'android.intent.action.VIEW', '-d', 'https://ca.indeed.com/jobs?q=retail&l=North+York%2C+ON&fromage=7&sort=date', '-p', 'com.indeed.android.jobsearch'])
time.sleep(6)
print('4. Scraping jobs...')
jobs = set()
i = 0
while i < 10: [jobs.add(n.get('content-desc')[16:]) for n in ET.fromstring(d.dump_hierarchy()).iter('node') if n.get('content-desc') and n.get('content-desc').startswith('full details of ')]; print(f'Scroll {i}: {len(jobs)} jobs'); d.shell('input swipe 540 1800 540 500 300'); time.sleep(1.5); i += 1
print('--- FINAL JOB LIST ---')
print(chr(10).join(sorted(jobs)))