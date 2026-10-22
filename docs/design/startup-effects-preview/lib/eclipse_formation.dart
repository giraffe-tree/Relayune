/// Six new first acts; all share the approved original water-cut ending.
enum EclipseFormation {
  roll('字母滚月', 'Rolling letters', '字母依次倾倒、滚拢，合成一轮满月。'),
  ring('弯字成环', 'Typographic ring', '整行文字弯成圆环，内缘缓缓闭合。'),
  ribbon('卷带入月', 'Ribbon coil', '字标展开成柔软的带，回卷成圆。'),
  drops('墨滴相拥', 'Ink gathering', '笔画润成墨滴，彼此贴近、融合。'),
  tide('潮汐包合', 'Tidal fold', '文字两端像潮水相向卷起，包合成月。'),
  elastic('柔弹成圆', 'Soft rebound', '字标收成软枕，轻轻回弹后变圆。');

  const EclipseFormation(this.zh, this.en, this.descriptionZh);
  final String zh, en, descriptionZh;
}
