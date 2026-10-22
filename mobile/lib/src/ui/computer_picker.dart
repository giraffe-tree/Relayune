import 'package:flutter/material.dart';
import '../state/app_controller.dart';
import '../state/computer_connections.dart';
import '../widgets/device_connection_icon.dart';

String computerText(BuildContext context, String zh, String en) =>
    Localizations.localeOf(context).languageCode == 'zh' ? zh : en;

/// Same selected computer in Home and the drawer. Color is a local cue;
/// names, connection labels and selection checks keep it accessible.
class ComputerPicker extends StatelessWidget {
  const ComputerPicker({
    super.key,
    required this.connections,
    required this.selected,
    required this.onChanged,
    this.compact = false,
  });
  final ComputerConnections connections;
  final AppController selected;
  final ValueChanged<AppController> onChanged;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: connections,
      builder: (context, _) => _iconPicker(context),
    );
  }

  Widget _iconPicker(BuildContext context) {
    final computers = connections.computers;
    if (compact && computers.length < 2) return const SizedBox.shrink();
    final prefix = compact ? 'home' : 'drawer';
    final visibleCount = MediaQuery.sizeOf(context).width < 360 ? 2 : 3;
    final count = computers.length < visibleCount
        ? computers.length
        : visibleCount;
    return Padding(
      padding: EdgeInsets.only(left: compact ? 12 : 0),
      child: SizedBox(
        width: compact ? 44.0 * count + 4.0 * (count - 1) : double.infinity,
        height: 44,
        child: ListView.separated(
          key: ValueKey('$prefix-computer-strip'),
          scrollDirection: Axis.horizontal,
          separatorBuilder: (_, _) => const SizedBox(width: 4),
          itemCount: computers.length + (compact ? 0 : 1),
          itemBuilder: (context, index) {
            if (index == computers.length) {
              return IconButton(
                key: const ValueKey('drawer-add-computer'),
                tooltip: computerText(context, '添加电脑', 'Add computer'),
                onPressed: connections.account.addComputer,
                icon: const Icon(Icons.add, size: 21),
              );
            }
            final c = computers[index];
            final id = connections.deviceId(c);
            final color = Color(connections.colorOf(c));
            final active = c == selected;
            final connection = deviceConnectionVisualState(
              online: c.deviceOnline,
              transport: c.connectionSnapshot.transport,
            );
            final offline = connection == DeviceConnectionVisualState.offline;
            final connecting =
                connection == DeviceConnectionVisualState.reconnecting;
            final iconColor = offline ? color.withValues(alpha: .45) : color;
            final pending = c.deviceOnline && c.pendingApprovalCount > 0;
            final unread = c.sessions.any(
              (session) =>
                  !session.isSubagent &&
                  c.sessionHasUnopenedCompletion(session),
            );
            final status = pending
                ? computerText(context, '有待审批', 'Approval needed')
                : unread
                ? computerText(context, '有未读会话', 'Unread conversations')
                : '';
            final label = [
              connections.name(c),
              switch (connection) {
                DeviceConnectionVisualState.online => computerText(
                  context,
                  '在线',
                  'Online',
                ),
                DeviceConnectionVisualState.offline => computerText(
                  context,
                  '离线',
                  'Offline',
                ),
                DeviceConnectionVisualState.reconnecting => computerText(
                  context,
                  '连接中',
                  'Connecting',
                ),
              },
              if (status.isNotEmpty) status,
            ].join(' · ');
            return Semantics(
              selected: active,
              child: Tooltip(
                message: label,
                child: SizedBox.square(
                  dimension: 44,
                  child: TextButton(
                    key: ValueKey('$prefix-computer-$id'),
                    onPressed: () => onChanged(c),
                    style: TextButton.styleFrom(
                      padding: EdgeInsets.zero,
                      minimumSize: const Size(44, 44),
                      foregroundColor: color,
                      backgroundColor: active
                          ? color.withValues(alpha: .09)
                          : Colors.transparent,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                      ),
                    ),
                    child: ExcludeSemantics(
                      child: Stack(
                        alignment: Alignment.center,
                        children: [
                          const SizedBox.expand(),
                          Icon(
                            Icons.computer_outlined,
                            size: 21,
                            color: iconColor,
                          ),
                          if (offline || connecting)
                            Positioned(
                              bottom: 7,
                              right: 5,
                              child: Container(
                                key: ValueKey(
                                  '$prefix-computer-${offline ? 'offline' : 'connecting'}-$id',
                                ),
                                width: 14,
                                height: 14,
                                padding: const EdgeInsets.all(1.5),
                                decoration: BoxDecoration(
                                  color: Theme.of(
                                    context,
                                  ).scaffoldBackgroundColor,
                                  shape: BoxShape.circle,
                                ),
                                child: offline
                                    ? Icon(
                                        Icons.remove_circle_outline,
                                        size: 11,
                                        color: color.withValues(alpha: .65),
                                      )
                                    : CircularProgressIndicator(
                                        strokeWidth: 1.5,
                                        color: color,
                                        value:
                                            MediaQuery.disableAnimationsOf(
                                              context,
                                            )
                                            ? .75
                                            : null,
                                      ),
                              ),
                            ),
                          if (active)
                            Positioned(
                              bottom: 4,
                              child: Container(
                                key: ValueKey('$prefix-computer-selected-$id'),
                                width: 10,
                                height: 2,
                                decoration: BoxDecoration(
                                  color: color,
                                  borderRadius: BorderRadius.circular(2),
                                ),
                              ),
                            ),
                          if (pending || unread)
                            Positioned(
                              top: pending ? 3 : 6,
                              right: pending ? 3 : 6,
                              child: Container(
                                key: ValueKey(
                                  pending
                                      ? '$prefix-computer-approval-$id'
                                      : '$prefix-computer-unread-$id',
                                ),
                                width: pending ? 14 : 8,
                                height: pending ? 14 : 8,
                                alignment: Alignment.center,
                                decoration: BoxDecoration(
                                  shape: BoxShape.circle,
                                  color: pending
                                      ? const Color(0xFFEFBF79)
                                      : Theme.of(context).colorScheme.onSurface,
                                  border: Border.all(
                                    color: Theme.of(
                                      context,
                                    ).scaffoldBackgroundColor,
                                    width: 1.5,
                                  ),
                                ),
                                child: pending
                                    ? const Text(
                                        '!',
                                        style: TextStyle(
                                          fontSize: 10,
                                          height: 1,
                                          fontWeight: FontWeight.w700,
                                          color: Color(0xFF231B0F),
                                        ),
                                      )
                                    : null,
                              ),
                            ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}

class ComputerColorPicker extends StatelessWidget {
  const ComputerColorPicker({
    super.key,
    required this.value,
    required this.onChanged,
  });
  final int value;
  final ValueChanged<int> onChanged;
  @override
  Widget build(BuildContext context) => Column(
    mainAxisSize: MainAxisSize.min,
    children: [
      Text(
        computerText(
          context,
          '电脑颜色 · 仅保存在此手机',
          'Computer color · Only on this phone',
        ),
        style: const TextStyle(fontSize: 12),
      ),
      const SizedBox(height: 8),
      Wrap(
        spacing: 2,
        children: [
          for (final (index, color) in ComputerConnections.colors.indexed)
            Semantics(
              selected: color == value,
              child: IconButton(
                key: ValueKey('computer-color-$index'),
                tooltip: computerText(
                  context,
                  ['薄荷绿', '蓝色', '紫色', '橙色', '粉色', '青色'][index],
                  ['Mint', 'Blue', 'Purple', 'Orange', 'Pink', 'Teal'][index],
                ),
                onPressed: () => onChanged(color),
                icon: Container(
                  width: 28,
                  height: 28,
                  decoration: BoxDecoration(
                    color: Color(color),
                    shape: BoxShape.circle,
                  ),
                  child: color == value
                      ? const Icon(Icons.check, size: 19, color: Colors.black)
                      : null,
                ),
              ),
            ),
        ],
      ),
    ],
  );
}
