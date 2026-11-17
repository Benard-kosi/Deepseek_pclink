import uiautomator2 as u2
import time
d = u2.connect()
d.shell('am start -a android.intent.action.VIEW -d https://ca.indeed.com/jobs?q=retail%26fromage=7%26sort=date')
time.sleep(5)
print(d.app_current().get('package'))