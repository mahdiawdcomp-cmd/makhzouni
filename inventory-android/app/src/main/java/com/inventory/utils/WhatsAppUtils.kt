package com.inventory.utils

import android.content.Context
import android.content.Intent
import android.net.Uri
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

fun sendWhatsApp(context: Context, phone: String, message: String) {
    val cleanPhone = phone.filter { it.isDigit() || it == '+' }
    val encodedMessage = URLEncoder.encode(message, StandardCharsets.UTF_8.toString())
    val intent = Intent(Intent.ACTION_VIEW).apply {
        data = Uri.parse("https://wa.me/$cleanPhone?text=$encodedMessage")
    }
    context.startActivity(intent)
}
