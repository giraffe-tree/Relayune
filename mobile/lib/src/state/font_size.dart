enum RelayFontSize {
  small(.85),
  medium(.925),
  large(1);

  const RelayFontSize(this.scale);

  /// Large preserves the original typography; system accessibility still applies.
  final double scale;

  static RelayFontSize fromStored(String? value) =>
      values.where((size) => size.name == value).firstOrNull ?? small;
}
