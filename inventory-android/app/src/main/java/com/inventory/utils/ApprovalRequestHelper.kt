package com.inventory.utils

import android.content.Context
import android.widget.Toast
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext

@Composable
fun StaffApprovalDialog(
    visible: Boolean,
    onDismiss: () -> Unit,
    onSendRequest: () -> Unit
) {
    if (!visible) return

    val context = LocalContext.current
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("سيُرسَل طلبك للمدير") },
        text = { Text("لا تملك صلاحية التنفيذ المباشر. سيتم إرسال الطلب للمراجعة.") },
        confirmButton = {
            TextButton(
                onClick = {
                    onSendRequest()
                    showApprovalSentToast(context)
                    onDismiss()
                }
            ) {
                Text("إرسال")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("إلغاء")
            }
        }
    )
}

fun showApprovalSentToast(context: Context) {
    Toast.makeText(context, "تم الإرسال، بانتظار الموافقة", Toast.LENGTH_SHORT).show()
}
