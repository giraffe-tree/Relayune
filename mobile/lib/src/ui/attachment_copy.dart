import 'package:flutter/widgets.dart';

/// Compact attachment controls, kept separate from agent/activity terminology.
String attachmentText(BuildContext context, String key, [int? count]) {
  const labels = <String, List<String>>{
    'zh': ['查看全部', '收起总览', '展开其余文件', '收起文件'],
    'en': ['View all', 'Close overview', 'More files', 'Fewer files'],
    'ar': ['عرض الكل', 'إغلاق العرض', 'ملفات أخرى', 'ملفات أقل'],
    'bn': ['সব দেখুন', 'সংক্ষিপ্ত করুন', 'আরও ফাইল', 'কম ফাইল'],
    'es': ['Ver todas', 'Cerrar vista', 'Más archivos', 'Menos archivos'],
    'fr': [
      'Tout voir',
      'Fermer l’aperçu',
      'Autres fichiers',
      'Moins de fichiers',
    ],
    'hi': ['सभी देखें', 'अवलोकन बंद करें', 'और फ़ाइलें', 'कम फ़ाइलें'],
    'id': [
      'Lihat semua',
      'Tutup ringkasan',
      'File lainnya',
      'Lebih sedikit file',
    ],
    'pt': [
      'Ver todas',
      'Fechar visão geral',
      'Mais arquivos',
      'Menos arquivos',
    ],
    'ur': ['سب دیکھیں', 'خلاصہ بند کریں', 'مزید فائلیں', 'کم فائلیں'],
  };
  final index = switch (key) {
    'all' => 0,
    'collapse' => 1,
    'files' => 2,
    _ => 3,
  };
  final label =
      (labels[Localizations.localeOf(context).languageCode] ??
      labels['en']!)[index];
  return count == null ? label : '$label · $count';
}
