package com.inventory.utils

import android.content.Context
import android.content.Intent
import android.net.Uri
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

fun sendWhatsApp(context: Context, phone: String, message: String) {
    val cleanPhone = normalizeIraqPhone(phone)
    val encodedMessage = URLEncoder.encode(message, StandardCharsets.UTF_8.toString())
    val intent = Intent(Intent.ACTION_VIEW).apply {
        data = Uri.parse("https://wa.me/$cleanPhone?text=$encodedMessage")
    }
    context.startActivity(intent)
}

private fun normalizeIraqPhone(phone: String): String {
    val digits = phone.mapNotNull { char ->
        when (char) {
            in '0'..'9' -> char
            in '٠'..'٩' -> ('0'.code + (char.code - '٠'.code)).toChar()
            in '۰'..'۹' -> ('0'.code + (char.code - '۰'.code)).toChar()
            else -> null
        }
    }.joinToString("")

    val withoutPrefix = if (digits.startsWith("00")) digits.drop(2) else digits
    return when {
        withoutPrefix.startsWith("964") -> withoutPrefix
        withoutPrefix.startsWith("0") -> "964" + withoutPrefix.drop(1)
        withoutPrefix.startsWith("7") -> "964$withoutPrefix"
        else -> withoutPrefix
    }
}
