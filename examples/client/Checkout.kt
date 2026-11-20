import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

data class CartItem(val productId: String, val quantity: Int)

sealed interface CheckoutState {
    data object Idle : CheckoutState
    data object Submitting : CheckoutState
    data object Failed : CheckoutState
    data class Pending(val orderId: String) : CheckoutState
    data class Paid(val orderId: String) : CheckoutState
}

class Checkout(
    private val api: String,
    private val presentPaymentSheet: suspend (clientSecret: String) -> Unit,
) {
    private val _state = MutableStateFlow<CheckoutState>(CheckoutState.Idle)
    val state: StateFlow<CheckoutState> = _state
    private var attemptKey: String? = null

    val canPay get() = _state.value == CheckoutState.Idle || _state.value == CheckoutState.Failed

    // A different cart is a different purchase, so it gets a new key.
    fun cartChanged() { attemptKey = null }

    suspend fun pay(items: List<CartItem>) {
        if (!canPay) return
        val key = attemptKey ?: UUID.randomUUID().toString().also { attemptKey = it }
        _state.value = CheckoutState.Submitting
        try {
            val body = JSONObject().put("items", JSONArray(items.map {
                JSONObject().put("productId", it.productId).put("quantity", it.quantity)
            }))
            val created = send("POST", "$api/payments", body.toString(), key, retries = 3)
            val orderId = created.getString("orderId")
            presentPaymentSheet(created.getString("clientSecret"))
            _state.value = CheckoutState.Pending(orderId)
            waitForServer(orderId)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            if (_state.value !is CheckoutState.Pending) _state.value = CheckoutState.Failed
        }
    }

    private suspend fun waitForServer(orderId: String) {
        repeat(30) {
            when (send("GET", "$api/orders/$orderId", retries = 2).getString("status")) {
                "paid" -> { _state.value = CheckoutState.Paid(orderId); attemptKey = null; return }
                "failed" -> { _state.value = CheckoutState.Failed; return }
            }
            delay(2_000)
        }
    }

    // Same request, same key. The server returns the first result instead of charging again.
    private suspend fun send(
        method: String, url: String, body: String? = null, key: String? = null, retries: Int,
    ): JSONObject {
        for (attempt in 1..retries) {
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    val conn = URL(url).openConnection() as HttpURLConnection
                    conn.requestMethod = method
                    key?.let { conn.setRequestProperty("Idempotency-Key", it) }
                    if (body != null) {
                        conn.doOutput = true
                        conn.setRequestProperty("Content-Type", "application/json")
                        conn.outputStream.use { it.write(body.toByteArray()) }
                    }
                    val code = conn.responseCode
                    code to if (code in 200..299) conn.inputStream.bufferedReader().use { it.readText() } else ""
                }
            }
            val (code, text) = result.getOrDefault(0 to "")
            if (code in 200..299) return JSONObject(text)
            if (code in 400..499 && code != 409) break
            delay(attempt * 1_000L)
        }
        throw IllegalStateException("Request failed: $method $url")
    }
}
