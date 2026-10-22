// Explicit QA-only entry point: flutter build apk --target tool/vivo_notification_qa.dart.
// Never used by normal builds; contains only synthetic task data.
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const MaterialApp(home: VivoNotificationQa()));
}

class VivoNotificationQa extends StatefulWidget {
  const VivoNotificationQa({super.key});
  @override
  State<VivoNotificationQa> createState() => _State();
}

class _State extends State<VivoNotificationQa> {
  static const push = MethodChannel('cn.giraffetree.relayune/push');
  static const live = MethodChannel('cn.giraffetree.relayune/live_tasks');
  String status = '正在读取能力…';
  final started = DateTime.now().millisecondsSinceEpoch;
  @override
  void initState() {
    super.initState();
    _capabilities();
  }

  Future<void> _capabilities() async {
    final value = await push.invokeMapMethod<String, dynamic>('capabilities');
    final consent = await push.invokeMethod<bool>('consented');
    if (mounted) {
      setState(
        () => status =
            '极光配置：${value?['configured']}\n原子岛场景已配置：${value?['vivoSceneConfigured']}\n场景权限可用：${value?['vivoSceneSupported']}\n推送已同意：$consent',
      );
    }
  }

  Future<void> _show(String state, String label) async {
    final plugin = FlutterLocalNotificationsPlugin();
    await plugin
        .resolvePlatformSpecificImplementation<
          AndroidFlutterLocalNotificationsPlugin
        >()
        ?.requestNotificationsPermission();
    final now = DateTime.now().millisecondsSinceEpoch;
    await live.invokeMethod<void>('update', {
      'sessionId': 'relayune_vivo_qa',
      'turnId': 'qa_$started',
      'state': state,
      'statusLabel': label,
      'title': '测试 · 检查移动端通知',
      'provider': 'Relayune QA',
      'updatedLabel': '更新于',
      'actionLabel': '打开 Relayune',
      'foreground': false,
      'connected': true,
      'updatedAt': now,
      'startedAt': started,
      'startKnown': true,
      if (state == 'completed') 'finishedAt': now,
    });
  }

  Future<void> _register() async {
    await push.invokeMethod<void>('consent');
    await push.invokeMethod<void>('configure', {'enabled': true});
    await Future<void>.delayed(const Duration(seconds: 3));
    final registration = await push.invokeMethod<String>('registration');
    if (mounted) {
      setState(
        () => status =
            '极光设备注册：${registration?.isNotEmpty == true ? "成功（标识已隐藏）" : "尚未取得标识，稍后重试"}\n这是设备注册测试，未绑定服务器账户。',
      );
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Relayune · vivo 真机验收')),
    body: ListView(
      padding: const EdgeInsets.all(24),
      children: [
        Text(status, style: const TextStyle(fontSize: 18, height: 1.5)),
        const SizedBox(height: 24),
        FilledButton(
          onPressed: () => _show('running', '进行中'),
          child: const Text('显示进行中卡片'),
        ),
        FilledButton(
          onPressed: () => _show('approval', '等待确认'),
          child: const Text('更新为等待确认'),
        ),
        FilledButton(
          onPressed: () => _show('completed', '已完成'),
          child: const Text('结束卡片'),
        ),
        OutlinedButton(
          onPressed: () => live.invokeMethod<void>('clear'),
          child: const Text('清除测试卡片'),
        ),
        const SizedBox(height: 24),
        const Text(
          '以下测试会启用极光推送，并向服务商发送推送标识、Android ID、设备与系统及网络信息，不包含任务内容或密钥。测试结束会关闭测试推送。',
        ),
        OutlinedButton(onPressed: _register, child: const Text('同意并测试极光设备注册')),
        OutlinedButton(
          onPressed: () async {
            await push.invokeMethod<void>('configure', {'enabled': false});
            await _capabilities();
          },
          child: const Text('停止测试推送'),
        ),
      ],
    ),
  );
}
