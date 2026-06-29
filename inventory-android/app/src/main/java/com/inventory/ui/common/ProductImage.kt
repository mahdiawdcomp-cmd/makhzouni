package com.inventory.ui.common

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Image as FoundationImage
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Image
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import coil.compose.AsyncImage

/**
 * Decode a `data:image/...;base64,...` string into a Bitmap. Coil does NOT
 * support data URIs out of the box, which is why product images (stored as
 * base64) never rendered with a plain AsyncImage.
 */
fun decodeDataUrl(value: String?): Bitmap? {
    if (value.isNullOrBlank() || !value.startsWith("data:")) return null
    return try {
        val base64 = value.substringAfter("base64,", "")
        if (base64.isEmpty()) return null
        val bytes = Base64.decode(base64, Base64.DEFAULT)
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
    } catch (e: Exception) {
        null
    }
}

/**
 * Renders a product image from either a base64 data URL (decoded locally) or a
 * normal http(s) URL (via Coil). Falls back to a placeholder icon when empty.
 * When [zoomable] is true, tapping the image opens a full-screen preview.
 */
@Composable
fun ProductImage(
    model: String?,
    contentDescription: String? = null,
    modifier: Modifier = Modifier,
    contentScale: ContentScale = ContentScale.Crop,
    zoomable: Boolean = false,
) {
    var showZoom by remember { mutableStateOf(false) }

    val isData = model?.startsWith("data:") == true
    val bitmap = remember(model) { if (isData) decodeDataUrl(model) else null }

    val clickMod = if (zoomable && (bitmap != null || (!model.isNullOrBlank() && !isData))) {
        modifier.clickable { showZoom = true }
    } else modifier

    when {
        bitmap != null -> FoundationImage(
            bitmap = bitmap.asImageBitmap(),
            contentDescription = contentDescription,
            modifier = clickMod,
            contentScale = contentScale,
        )
        !model.isNullOrBlank() && !isData -> AsyncImage(
            model = model,
            contentDescription = contentDescription,
            modifier = clickMod,
            contentScale = contentScale,
        )
        else -> Box(
            modifier = modifier.background(MaterialTheme.colorScheme.surfaceVariant),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Filled.Image, contentDescription = null, tint = Color(0xFF94A3B8))
        }
    }

    if (showZoom) {
        Dialog(onDismissRequest = { showZoom = false }) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color(0xCC000000))
                    .clickable { showZoom = false }
                    .padding(16.dp),
                contentAlignment = Alignment.Center,
            ) {
                if (bitmap != null) {
                    FoundationImage(
                        bitmap = bitmap.asImageBitmap(),
                        contentDescription = contentDescription,
                        modifier = Modifier.fillMaxSize(),
                        contentScale = ContentScale.Fit,
                    )
                } else if (!model.isNullOrBlank()) {
                    AsyncImage(
                        model = model,
                        contentDescription = contentDescription,
                        modifier = Modifier.fillMaxSize(),
                        contentScale = ContentScale.Fit,
                    )
                }
            }
        }
    }
}
