import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:gal/gal.dart';

/// Saves original image bytes to the device's photo library.
class SaveImageButton extends StatefulWidget {
  const SaveImageButton({
    super.key,
    required this.loadBytes,
    required this.name,
  });

  final Future<Uint8List> Function() loadBytes;
  final String name;

  @override
  State<SaveImageButton> createState() => _SaveImageButtonState();
}

class _SaveImageButtonState extends State<SaveImageButton> {
  bool _saving = false;

  String _copy(int index) {
    const labels = {
      'zh': ['保存图片', '已保存到相册', '请在系统设置中允许保存图片到相册后重试。', '保存失败，请重试。'],
      'en': [
        'Save image',
        'Saved to Photos',
        'Allow saving to Photos in system settings, then try again.',
        'Could not save the image. Try again.',
      ],
      'ar': [
        'حفظ الصورة',
        'تم الحفظ في الصور',
        'اسمح بحفظ الصور في إعدادات النظام ثم حاول مجددًا.',
        'تعذر حفظ الصورة. حاول مجددًا.',
      ],
      'bn': [
        'ছবি সংরক্ষণ',
        'ফটোতে সংরক্ষিত',
        'সিস্টেম সেটিংসে ছবি সংরক্ষণের অনুমতি দিয়ে আবার চেষ্টা করুন।',
        'ছবি সংরক্ষণ করা যায়নি। আবার চেষ্টা করুন।',
      ],
      'es': [
        'Guardar imagen',
        'Guardada en Fotos',
        'Permite guardar en Fotos en los ajustes del sistema e inténtalo de nuevo.',
        'No se pudo guardar la imagen. Inténtalo de nuevo.',
      ],
      'fr': [
        'Enregistrer l’image',
        'Enregistrée dans Photos',
        'Autorisez l’enregistrement dans Photos dans les réglages système, puis réessayez.',
        'Impossible d’enregistrer l’image. Réessayez.',
      ],
      'hi': [
        'चित्र सहेजें',
        'फ़ोटो में सहेजा गया',
        'सिस्टम सेटिंग में फ़ोटो सहेजने की अनुमति दें और फिर कोशिश करें।',
        'चित्र सहेजा नहीं जा सका। फिर कोशिश करें।',
      ],
      'id': [
        'Simpan gambar',
        'Disimpan ke Foto',
        'Izinkan penyimpanan ke Foto di pengaturan sistem, lalu coba lagi.',
        'Gagal menyimpan gambar. Coba lagi.',
      ],
      'pt': [
        'Salvar imagem',
        'Salva em Fotos',
        'Permita salvar em Fotos nos ajustes do sistema e tente novamente.',
        'Não foi possível salvar a imagem. Tente novamente.',
      ],
      'ur': [
        'تصویر محفوظ کریں',
        'تصاویر میں محفوظ ہو گئی',
        'سسٹم کی ترتیبات میں تصاویر محفوظ کرنے کی اجازت دیں، پھر کوشش کریں۔',
        'تصویر محفوظ نہیں ہو سکی۔ دوبارہ کوشش کریں۔',
      ],
    };
    return (labels[Localizations.localeOf(context).languageCode] ??
        labels['en']!)[index];
  }

  Future<void> _save() async {
    if (_saving) return;
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _saving = true);
    var denied = false;
    try {
      if (!await Gal.hasAccess() && !await Gal.requestAccess()) {
        denied = true;
        throw StateError('Photo access denied');
      }
      if (!mounted) return;
      final bytes = await widget.loadBytes();
      if (!mounted) return;
      // Gal expects a base name without an extension or path separators.
      final basename = widget.name.split(RegExp(r'[/\\]')).last;
      final dot = basename.lastIndexOf('.');
      final name = dot > 0 ? basename.substring(0, dot) : basename;
      await Gal.putImageBytes(bytes, name: name.isEmpty ? 'Relayune' : name);
      if (mounted) {
        messenger.showSnackBar(SnackBar(content: Text(_copy(1))));
      }
    } on Object catch (error) {
      if (!mounted) return;
      denied =
          denied ||
          error is GalException && error.type == GalExceptionType.accessDenied;
      messenger.showSnackBar(SnackBar(content: Text(_copy(denied ? 2 : 3))));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) => IconButton(
    tooltip: _copy(0),
    onPressed: _saving ? null : _save,
    icon: _saving
        ? const SizedBox.square(
            dimension: 18,
            child: CircularProgressIndicator(strokeWidth: 2),
          )
        : const Icon(Icons.save_alt_rounded),
  );
}
