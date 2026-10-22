/// Stable IDs are stored locally; reordering this catalog does not change a choice.
enum StartupEffect {
  stardust(
    '星尘回信',
    'Stardust',
    '字形散作星尘，沿柔和轨迹凝聚。',
    'Letters drift into dust and gather into the moon.',
  ),
  orbit(
    '双轨引力',
    'Twin orbits',
    '上下两股字流绕行，合拢成月。',
    'Two streams orbit and settle into the moon.',
  ),
  liquid(
    '液态月相',
    'Liquid moon',
    '笔画融化相拥，流动中长出月形。',
    'Letterforms melt and flow into the moon.',
  ),
  filaments(
    '丝线回环',
    'Silk loops',
    '笔画抽成丝线，回卷织成图标。',
    'Strokes unwind into threads and weave the icon.',
  ),
  raster(
    '光栅重组',
    'Raster weave',
    '字形切成细片，错位滑动后重组。',
    'Fine slices slide and assemble into the icon.',
  ),
  eclipse(
    '月蚀显影',
    'Eclipse',
    '文字凝成月盘，弯曲暗隙显出图标。',
    'Letters form a lunar disc, carved by a curved shadow.',
  );

  const StartupEffect(this.zh, this.en, this.descriptionZh, this.descriptionEn);
  final String zh;
  final String en;
  final String descriptionZh;
  final String descriptionEn;
  String title(bool chinese) => chinese ? zh : en;
  String description(bool chinese) => chinese ? descriptionZh : descriptionEn;
  static StartupEffect fromId(String? id) =>
      values.firstWhere((effect) => effect.name == id, orElse: () => stardust);
}
