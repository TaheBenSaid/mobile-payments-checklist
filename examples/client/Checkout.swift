import Combine
import Foundation

struct CartItem: Encodable { let productId: String; let quantity: Int }

enum CheckoutState: Equatable {
    case idle, submitting, failed
    case pending(orderId: String)
    case paid(orderId: String)
}

@MainActor
final class CheckoutModel: ObservableObject {
    @Published private(set) var state: CheckoutState = .idle
    private var attemptKey: String?
    private let api: URL
    private let presentPaymentSheet: (_ clientSecret: String) async throws -> Void

    init(api: URL, presentPaymentSheet: @escaping (String) async throws -> Void) {
        self.api = api
        self.presentPaymentSheet = presentPaymentSheet
    }

    var canPay: Bool { state == .idle || state == .failed }

    // A different cart is a different purchase, so it gets a new key.
    func cartChanged() { attemptKey = nil }

    func pay(_ items: [CartItem]) async {
        guard canPay else { return }
        let key = attemptKey ?? UUID().uuidString
        attemptKey = key
        state = .submitting
        do {
            var req = URLRequest(url: api.appendingPathComponent("payments"))
            req.httpMethod = "POST"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.setValue(key, forHTTPHeaderField: "Idempotency-Key")
            req.httpBody = try JSONEncoder().encode(["items": items])

            let created: Created = try await send(req, retries: 3)
            try await presentPaymentSheet(created.clientSecret)
            state = .pending(orderId: created.orderId)
            try await waitForServer(created.orderId)
        } catch {
            if case .pending = state { return }
            state = .failed
        }
    }

    private struct Created: Decodable { let orderId: String; let clientSecret: String }
    private struct Order: Decodable { let status: String }

    // Same request, same key. The server returns the first result instead of charging again.
    private func send<T: Decodable>(_ req: URLRequest, retries: Int) async throws -> T {
        for attempt in 1...retries {
            if let (data, res) = try? await URLSession.shared.data(for: req) {
                let code = (res as? HTTPURLResponse)?.statusCode ?? 0
                if (200..<300).contains(code) { return try JSONDecoder().decode(T.self, from: data) }
                if code < 500 && code != 409 { break }
            }
            try await Task.sleep(nanoseconds: UInt64(attempt) * 1_000_000_000)
        }
        throw URLError(.cannotLoadFromNetwork)
    }

    private func waitForServer(_ orderId: String) async throws {
        let req = URLRequest(url: api.appendingPathComponent("orders/\(orderId)"))
        for _ in 0..<30 {
            let order: Order = try await send(req, retries: 2)
            if order.status == "paid" { state = .paid(orderId: orderId); attemptKey = nil; return }
            if order.status == "failed" { state = .failed; return }
            try await Task.sleep(nanoseconds: 2_000_000_000)
        }
    }
}
