import '../models.dart';

/// Update an already chronological list without re-sorting its history.
/// Most streaming updates change only the last item's content.
void placeMessageInOrder(
  List<RelayMessage> messages,
  RelayMessage message, {
  required int existingIndex,
}) {
  if (existingIndex >= 0) {
    if (messages[existingIndex].createdAt == message.createdAt) {
      messages[existingIndex] = message;
      return;
    }
    messages.removeAt(existingIndex);
  }
  // Upper bound preserves arrival order for equal timestamps.
  var low = 0;
  var high = messages.length;
  while (low < high) {
    final middle = low + ((high - low) ~/ 2);
    if (messages[middle].createdAt.compareTo(message.createdAt) <= 0) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  messages.insert(low, message);
}
