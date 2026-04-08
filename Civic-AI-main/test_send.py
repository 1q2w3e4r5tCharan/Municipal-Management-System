from src import notifications
to = ['your-test-email@example.com']
subject = 'Test email from local app'
body = 'Test message body'
ok = notifications.send_email(to, subject, body)
print('send_email returned', ok)

