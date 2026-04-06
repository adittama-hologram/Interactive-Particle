---
name: QA Skill
description: Helps with QA task for resolving bugs and issues in the project.
---

# QA Skill
Make sure you have the following tools:
- Browser
- Terminal
- File System

When Reviewing do these :

1. Be spesific about the task you are doing.
2. Read The terminal to check the issue or errors that happened
3. Make sure the code is do what its supposed to do
4. Is there any other issue or errors that happened
5. Fix the issue or errors
6. Test the code
7. If the code works locally but not in Docker:
    - Rebuild containers with `docker compose up -d --build`.
    - Use volume mounts (`.:/usr/src/app`) for real-time updates.
8. If port conflict happens (e.g., Port 3000 in use):
    - Run `netstat -ano | findstr :3000` to find the PID.
    - Run `taskkill /f /pid <PID>` to free the port.
9. Verify that root routes (`app.get('/')`) don't override static file serving of the frontend.
10. If the user still sees old content, instruct them to clear browser cache or use Incognito mode.

How to Provide feedback :
1. Be spesific
2. Explain why not just what
3. Suggest if there is alternatives

