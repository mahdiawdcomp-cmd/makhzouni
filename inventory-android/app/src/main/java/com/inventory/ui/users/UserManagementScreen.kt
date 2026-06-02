package com.inventory.ui.users

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun UserManagementScreen(viewModel: UserManagementViewModel) {
    val users by viewModel.users.collectAsState()
    var showDialog by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text("إدارة المستخدمين")
            Button(onClick = { showDialog = true }) {
                Text("إضافة")
            }
        }
        Spacer(Modifier.height(12.dp))
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(users) { user ->
                Card {
                    Column(Modifier.padding(12.dp)) {
                        Text("${user.name} (${user.username})")
                        Text("الصلاحية: ${user.role} - الحالة: ${if (user.isActive) "فعال" else "معطل"}")
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            TextButton(onClick = { viewModel.setRole(user, if (user.role == "ADMIN") "STAFF" else "ADMIN") }) {
                                Text("تغيير الصلاحية")
                            }
                            TextButton(onClick = { viewModel.deactivate(user) }) {
                                Text("تعطيل")
                            }
                        }
                    }
                }
            }
        }
    }

    if (showDialog) {
        AddUserDialog(
            onDismiss = { showDialog = false },
            onSave = { name, username, password, role ->
                viewModel.createUser(name, username, password, role)
                showDialog = false
            }
        )
    }
}

@Composable
private fun AddUserDialog(
    onDismiss: () -> Unit,
    onSave: (String, String, String, String) -> Unit
) {
    var name by remember { mutableStateOf("") }
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var role by remember { mutableStateOf("STAFF") }

    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = { onSave(name, username, password, role) }) {
                Text("حفظ")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("إلغاء") }
        },
        title = { Text("إضافة مستخدم") },
        text = {
            Column {
                OutlinedTextField(name, { name = it }, label = { Text("الاسم") })
                OutlinedTextField(username, { username = it }, label = { Text("اسم المستخدم") })
                OutlinedTextField(password, { password = it }, label = { Text("كلمة المرور") })
                Row {
                    TextButton(onClick = { role = "STAFF" }) { Text("STAFF") }
                    TextButton(onClick = { role = "ADMIN" }) { Text("ADMIN") }
                }
            }
        }
    )
}
