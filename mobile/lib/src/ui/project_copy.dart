// Keep labels aligned with app/add-project.tsx.
const projectCopy = <String, List<String>>{
  "checking": ["正在检查目录…", "Checking folder…"],
  "canCreate": ["目录不存在，可以新建", "Folder does not exist. Ready to create."],
  "checkPending": ["检查通过后才可新建", "Check must pass before creating."],
  "checkAgain": ["重新检查", "Check again"],
  "project_check_failed": ["目录检查失败，请重试", "Folder check failed. Try again."],
  "title": ["新增项目", "Add project"],
  "new": ["新建文件夹", "New folder"],
  "existing": ["已有文件夹", "Existing folder"],
  "name": ["项目名称", "Project name"],
  "location": ["保存位置", "Save location"],
  "parents": ["选择已有项目的父目录", "Choose a parent folder of an existing project"],
  "browse": ["浏览其他位置", "Browse locations"],
  "refresh": ["刷新位置", "Refresh locations"],
  "more": ["更多已有位置", "More locations"],
  "create": ["创建项目", "Create project"],
  "add": ["添加项目", "Add project"],
  "cancel": ["关闭", "Close"],
  "back": ["返回", "Back"],
  "select": ["选择此文件夹", "Select this folder"],
  "working": ["正在处理…", "Working…"],
  "online": ["在线", "Online"],
  "offline": [
    "电脑离线，连接后可创建",
    "Computer offline. Reconnect to create a project.",
  ],
  "local": ["文件保存在这台电脑上", "Files stay on this computer"],
  "empty": [
    "没有可用位置，请检查电脑上的文件夹是否存在及系统访问权限，然后刷新。",
    "No available locations. Check that the folders exist and the computer allows access, then refresh.",
  ],
  "ready": ["项目已就绪", "Project ready"],
  "coworkStart": [
    "请在 Claude Desktop 中选择此文件夹新建会话，再回到 Relayune 继续。",
    "Create a session with this folder in Claude Desktop, then return to Relayune.",
  ],
  "prompt": ["想在这个项目里做什么？", "What would you like to do in this project?"],
  "start": ["开始任务", "Start task"],
  "retry": ["重试并确认结果", "Retry and check result"],
  "taskFailed": [
    "任务尚未确认，请到项目会话中查看后再试。",
    "Task not confirmed. Check the project's sessions before retrying.",
  ],
  "unsupported": [
    "当前 Agent 或电脑版不支持新增项目，请更新电脑版后重试。",
    "This agent or desktop version does not support adding projects. Update the desktop app and retry.",
  ],
  "invalid_name": [
    "请输入有效文件夹名称，不包含路径分隔符。",
    "Enter a valid folder name without path separators.",
  ],
  "permission_denied": [
    "此位置没有所需权限，请选择其他位置。",
    "Permission unavailable. Choose another location.",
  ],
  "location_unavailable": [
    "此位置不可用，请刷新或重新选择。",
    "Location unavailable. Refresh or choose another.",
  ],
  "already_exists": [
    "已有同名文件夹，请切换到「已有文件夹」添加。",
    "A folder with this name exists. Add it using Existing folder.",
  ],
  "creation_unconfirmed": [
    "目录可能已创建，请通过「已有文件夹」检查并添加。",
    "The folder may already exist. Check and add it using Existing folder.",
  ],
  "save_failed_directory_created": [
    "文件夹已创建，项目尚未保存。可重试添加。",
    "Folder created, but project not saved. Retry to finish adding it.",
  ],
  "save_failed": ["项目尚未保存，可重试添加。", "Project not saved. Retry to add it."],
  "project_failed": [
    "暂未确认结果。可重试查询同一操作。",
    "Result not confirmed. Retry the same operation.",
  ],
  "location_changed": [
    "文件夹位置发生变化，请重新选择。",
    "Folder location changed. Select it again.",
  ],
  "noFolders": ["此目录没有子文件夹", "No subfolders here"],
  "loadMore": ["加载更多", "Load more"],
};

String projectText(String locale, String key) =>
    (projectCopy[key] ?? projectCopy['project_failed']!)[locale.startsWith('zh')
        ? 0
        : 1];
