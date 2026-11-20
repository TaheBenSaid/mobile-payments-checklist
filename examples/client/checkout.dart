import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

enum CheckoutStatus { idle, submitting, pending, paid, failed }

typedef CartItem = ({String productId, int quantity});

class Checkout {
  Checkout({required this.api, required this.presentPaymentSheet});

  final Uri api;
  final Future<void> Function(String clientSecret) presentPaymentSheet;
  final status = StreamController<CheckoutStatus>.broadcast();
  final _http = HttpClient();
  var _status = CheckoutStatus.idle;
  String? _attemptKey;
  String? orderId;

  bool get canPay =>
      _status == CheckoutStatus.idle || _status == CheckoutStatus.failed;

  // A different cart is a different purchase, so it gets a new key.
  void cartChanged() => _attemptKey = null;

  Future<void> pay(List<CartItem> items) async {
    if (!canPay) return;
    final key = _attemptKey ??= _uuidV4();
    _emit(CheckoutStatus.submitting);
    try {
      final lines = [
        for (final i in items)
          {'productId': i.productId, 'quantity': i.quantity},
      ];
      final created = await _send(
        'POST',
        'payments',
        key: key,
        body: {'items': lines},
        retries: 3,
      );
      orderId = created['orderId'] as String;
      await presentPaymentSheet(created['clientSecret'] as String);
      _emit(CheckoutStatus.pending);
      await _waitForServer(orderId!);
    } catch (_) {
      if (_status != CheckoutStatus.pending) _emit(CheckoutStatus.failed);
    }
  }

  Future<void> _waitForServer(String id) async {
    for (var i = 0; i < 30; i++) {
      final order = await _send('GET', 'orders/$id', retries: 2);
      if (order['status'] == 'paid') {
        _attemptKey = null;
        return _emit(CheckoutStatus.paid);
      }
      if (order['status'] == 'failed') return _emit(CheckoutStatus.failed);
      await Future<void>.delayed(const Duration(seconds: 2));
    }
  }

  // Same request, same key. The server returns the first result instead of charging again.
  Future<Map<String, dynamic>> _send(
    String method,
    String path, {
    String? key,
    Object? body,
    required int retries,
  }) async {
    for (var attempt = 1; attempt <= retries; attempt++) {
      try {
        final req = await _http.openUrl(method, api.resolve(path));
        if (key != null) req.headers.set('Idempotency-Key', key);
        if (body != null) {
          req.headers.contentType = ContentType.json;
          req.write(jsonEncode(body));
        }
        final res = await req.close().timeout(const Duration(seconds: 15));
        final text = await res.transform(utf8.decoder).join();
        if (res.statusCode >= 200 && res.statusCode < 300) {
          return jsonDecode(text) as Map<String, dynamic>;
        }
        if (res.statusCode < 500 && res.statusCode != 409) break;
      } catch (e) {
        if (e is! IOException && e is! TimeoutException) rethrow;
      }
      await Future<void>.delayed(Duration(seconds: attempt));
    }
    throw StateError('Request failed: $method $path');
  }

  void _emit(CheckoutStatus next) => status.add(_status = next);

  void dispose() {
    _http.close();
    status.close();
  }
}

String _uuidV4() {
  final b = List<int>.generate(16, (_) => Random.secure().nextInt(256));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  final h = b.map((x) => x.toRadixString(16).padLeft(2, '0')).join();
  return '${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-'
      '${h.substring(16, 20)}-${h.substring(20)}';
}
