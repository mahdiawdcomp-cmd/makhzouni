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
import androidx.compose.material3.Checkbox
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.inventory.domain.model.User

@Composable
fun UserManagementScreen(viewModel: UserManagementViewModel) {
    val users by viewModel.users.collectAsState()
    var editingUser by remember { mutableStateOf<User?>(null) }
    var showDialog by remember { mutableStateOf(false) }
    var userToDelete by remember { mutableStateOf<User?>(null) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text("إدارة المستخدمين", fontWeight = FontWeight.Bold)
            Button(onClick = {
                editingUser = null
                showDialog = true
            }) {
                Text("إضافة")
            }
        }
        Spacer(Modifier.height(12.dp))
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(users) { user ->
                Card {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("${user.name} (${user.username})", fontWeight = FontWeight.Bold)
                        Text("الدور: ${if (user.role == "ADMIN") "مدير" else "موظف"}")
                        Text("الحالة: ${if (user.isActive) "فعال" else "معطل"}")
                        val permissions = if (user.role == "ADMIN") userPermissionOptions.map { it.id } else user.permissions
                        Text(
                            "الصلاحيات: " + if (permissions.isEmpty()) "بدون صلاحيات محددة" else permissions.joinToString("، ") { permissionId ->
                                userPermissionOptions.firstOrNull { it.id == permissionId }?.label ?: permissionId
                            }
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            TextButton(onClick = {
                                editingUser = user
                                showDialog = true
                            }) {
                                Text("تعديل")
                            }
                            TextButton(enabled = user.isActive, onClick = { viewModel.deactivate(user) }) {
                                Text("تعطيل")
                            }
                            TextButton(onClick = { userToDelete = user }) {
                                Text("حذف نهائي")
                            }
                        }
                    }
                }
            }
        }
    }

    userToDelete?.let { user ->
        AlertDialog(
            onDismissRequest = { userToDelete = null },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.deletePermanently(user)
                    userToDelete = null
                }) { Text("حذف") }
            },
            dismissButton = { TextButton(onClick = { userToDelete = null }) { Text("إلغاء") } },
            title = { Text("حذف نهائي") },
            text = { Text("إذا المستخدم عنده فواتير أو سندات راح ينرفض الحذف حفاظاً على الحسابات.") }
        )
    }

    if (showDialog) {
        UserFormDialog(
            user = editingUser,
            onDismiss = { showDialog = false },
            onSave = { name, username, password, role, permissions, isActive ->
                viewModel.saveUser(editingUser, name, username, password, role, permissions, isActive)
                showDialog = false
            }
        )
    }
}

@Composable
private fun UserFormDialog(
    user: User?,
    onDismiss: () -> Unit,
    onSave: (String, String, String, String, List<String>, Boolean) -> Unit
) {
    var name by remember(user?.id) { mutableStateOf(user?.name.orEmpty()) }
    var username by remember(user?.id) { mutableStateOf(user?.username.orEmpty()) }
    var password by remember(user?.id) { mutableStateOf("") }
    var role by remember(user?.id) { mutableStateOf(user?.role ?: "STAFF") }
    var permissions by remember(user?.id) { mutableStateOf(user?.permissions ?: emptyList()) }
    var isActive by remember(user?.id) { mutableStateOf(user?.isActive ?: true) }
    val isAdmin = role == "ADMIN"
    val effectivePermissions = if (isAdmin) userPermissionOptions.map { it.id } else permissions

    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(
                enabled = name.isNotBlank() && username.isNotBlank() && (user != null || password.length >= 4),
                onClick = { onSave(name, username, password, role, effectivePermissions, isActive) }
            ) {
                Text("حفظ")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("إلغاء") }
        },
        title = { Text(if (user == null) "إضافة مستخدم" else "تعديل مستخدم") },
        text = {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                item {
                    OutlinedTextField(name, { name = it }, label = { Text("الاسم") }, singleLine = true)
                }
                item {
                    OutlinedTextField(username, { username = it }, label = { Text("اسم المستخدم") }, singleLine = true)
                }
                item {
                    OutlinedTextField(
                        password,
                        { password = it },
                        label = { Text(if (user == null) "كلمة المرور" else "كلمة مرور جديدة (اختياري)") },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation()
                    )
                }
                item {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TextButton(onClick = { role = "STAFF" }) { Text(if (role == "STAFF") "✓ موظف" else "موظف") }
                        TextButton(onClick = {
                            role = "ADMIN"
                            permissions = userPermissionOptions.map { it.id }
                        }) { Text(if (role == "ADMIN") "✓ مدير كامل" else "مدير كامل") }
                    }
                }
                item {
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("الحساب فعال")
                        Switch(checked = isActive, onCheckedChange = { isActive = it })
                    }
                }
                item {
                    Text("الصلاحيات", fontWeight = FontWeight.Bold)
                }
                items(userPermissionOptions) { option ->
                    val checked = isAdmin || permissions.contains(option.id)
                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Checkbox(
                            checked = checked,
                            enabled = !isAdmin,
                            onCheckedChange = {
                                permissions = if (checked) permissions - option.id else permissions + option.id
                            }
                        )
                        Column {
                            Text(option.label, fontWeight = FontWeight.SemiBold)
                            Text(option.hint)
                        }
                    }
                }
                if (isAdmin) {
                    item { Text("المدير الكامل يحصل على كل الصلاحيات تلقائياً.") }
                }
            }
        }
    )
}
