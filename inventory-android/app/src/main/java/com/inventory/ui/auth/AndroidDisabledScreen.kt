package com.inventory.ui.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * Gate shown only when the tenant's entitlements explicitly disable the Android
 * platform (platforms.androidEnabled == false). This is NOT a logout — no local
 * data is cleared and the serial/session stay intact. The retry button simply
 * re-runs the whole splash/entitlement check.
 */
@Composable
fun AndroidDisabledScreen(onRetry: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text("🚫", fontSize = 64.sp, modifier = Modifier.padding(bottom = 16.dp))

        Text(
            text = "تطبيق الأندرويد غير مفعّل لهذا المتجر. تواصل مع الدعم.",
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onSurface
        )

        Button(
            onClick = onRetry,
            modifier = Modifier.padding(top = 28.dp).height(52.dp)
        ) {
            Text("إعادة المحاولة", fontSize = 16.sp)
        }
    }
}
