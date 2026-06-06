package com.inventory.ui.catalog

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.inventory.data.remote.dto.CatalogCustomerDto
import com.inventory.ui.common.StatusBadge
import com.inventory.ui.common.StatusType
import com.inventory.ui.theme.AppColor

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CatalogManagementScreen(
    viewModel: CatalogManagementViewModel,
    onBack: () -> Unit
) {
    val state by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    var searchQuery by remember { mutableStateOf("") }

    // Show snackbar for errors / success
    val snackbarHostState = remember { SnackbarHostState() }
    LaunchedEffect(state.error) {
        state.error?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearMessage()
        }
    }
    LaunchedEffect(state.actionSuccess) {
        if (state.actionSuccess) {
            snackbarHostState.showSnackbar("تم تنفيذ العملية بنجاح")
            viewModel.clearMessage()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = "إدارة الكاتلوك",
                        style = MaterialTheme.typography.titleLarge,
                        fontWeight = FontWeight.SemiBold
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "رجوع")
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.surface,
                    titleContentColor = MaterialTheme.colorScheme.onSurface,
                    navigationIconContentColor = MaterialTheme.colorScheme.onSurface,
                ),
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            // Search
            OutlinedTextField(
                value = searchQuery,
                onValueChange = { searchQuery = it },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                placeholder = { Text("بحث بالاسم أو رقم الهاتف") },
                leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                singleLine = true,
                shape = RoundedCornerShape(12.dp),
            )

            if (state.isLoading) {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            } else {
                val filtered = state.customers.filter { customer ->
                    searchQuery.isBlank() ||
                            customer.name.contains(searchQuery, ignoreCase = true) ||
                            customer.phone.contains(searchQuery)
                }

                if (filtered.isEmpty()) {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "لا يوجد زبائن",
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                } else {
                    LazyColumn(
                        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        items(filtered, key = { it.id }) { customer ->
                            CatalogCustomerCard(
                                customer = customer,
                                onGrant = { allowPrices, showStock ->
                                    viewModel.grantAccess(customer.id, allowPrices, showStock)
                                },
                                onPatchAllowPrices = { value ->
                                    viewModel.patchAccess(customer.id, allowPrices = value)
                                },
                                onPatchShowStock = { value ->
                                    viewModel.patchAccess(customer.id, showStock = value)
                                },
                                onRevoke = { viewModel.revokeAccess(customer.id) },
                                onCopyLink = { token ->
                                    val clipboardManager =
                                        context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                                    val link = "${getCatalogBaseUrl()}/catalog/$token"
                                    clipboardManager.setPrimaryClip(
                                        ClipData.newPlainText("رابط الكاتلوك", link)
                                    )
                                    Toast.makeText(context, "تم نسخ الرابط", Toast.LENGTH_SHORT).show()
                                }
                            )
                        }
                        item { Spacer(Modifier.height(24.dp)) }
                    }
                }
            }
        }
    }
}

@Composable
private fun CatalogCustomerCard(
    customer: CatalogCustomerDto,
    onGrant: (allowPrices: Boolean, showStock: Boolean) -> Unit,
    onPatchAllowPrices: (Boolean) -> Unit,
    onPatchShowStock: (Boolean) -> Unit,
    onRevoke: () -> Unit,
    onCopyLink: (token: String) -> Unit
) {
    var showGrantDialog by remember { mutableStateOf(false) }
    var showRevokeDialog by remember { mutableStateOf(false) }

    if (showGrantDialog) {
        GrantAccessDialog(
            onDismiss = { showGrantDialog = false },
            onConfirm = { allowPrices, showStock ->
                showGrantDialog = false
                onGrant(allowPrices, showStock)
            }
        )
    }

    if (showRevokeDialog) {
        AlertDialog(
            onDismissRequest = { showRevokeDialog = false },
            title = { Text("سحب الصلاحية") },
            text = { Text("هل تريد سحب صلاحية الكاتلوك من ${customer.name}؟") },
            confirmButton = {
                TextButton(
                    onClick = {
                        showRevokeDialog = false
                        onRevoke()
                    }
                ) { Text("سحب", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(onClick = { showRevokeDialog = false }) { Text("إلغاء") }
            }
        )
    }

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp)
    ) {
        Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            // Header: name + status chip
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Icon(Icons.Default.Person, contentDescription = null, tint = AppColor.Blue600, modifier = Modifier.size(18.dp))
                    Text(customer.name, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                }
                StatusBadge(
                    label = if (customer.hasAccess) "نشط" else "بدون صلاحية",
                    type = if (customer.hasAccess) StatusType.SUCCESS else StatusType.NEUTRAL
                )
            }

            // Phone
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(Icons.Default.Phone, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(14.dp))
                Text(customer.phone, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }

            if (customer.hasAccess) {
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)

                // Toggles
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    // allowPrices
                    Row(
                        modifier = Modifier.weight(1f),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("أسعار", style = MaterialTheme.typography.labelMedium)
                        Switch(
                            checked = customer.allowPrices,
                            onCheckedChange = onPatchAllowPrices,
                            modifier = Modifier.height(24.dp)
                        )
                    }
                    // showStock
                    Row(
                        modifier = Modifier.weight(1f),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("كميات", style = MaterialTheme.typography.labelMedium)
                        Switch(
                            checked = customer.showStock,
                            onCheckedChange = onPatchShowStock,
                            modifier = Modifier.height(24.dp)
                        )
                    }
                }

                // Actions: copy link + revoke
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = { customer.token?.let(onCopyLink) },
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(8.dp),
                        enabled = customer.token != null
                    ) {
                        Icon(Icons.Default.ContentCopy, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("نسخ الرابط", style = MaterialTheme.typography.labelMedium)
                    }
                    Button(
                        onClick = { showRevokeDialog = true },
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(8.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = AppColor.Red600)
                    ) {
                        Icon(Icons.Default.Delete, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("سحب", style = MaterialTheme.typography.labelMedium)
                    }
                }
            } else {
                // Grant access button
                Button(
                    onClick = { showGrantDialog = true },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(8.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = AppColor.Green600)
                ) {
                    Text("منح صلاحية", style = MaterialTheme.typography.labelLarge)
                }
            }
        }
    }
}

@Composable
private fun GrantAccessDialog(
    onDismiss: () -> Unit,
    onConfirm: (allowPrices: Boolean, showStock: Boolean) -> Unit
) {
    var allowPrices by remember { mutableStateOf(true) }
    var showStock by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("منح صلاحية الكاتلوك") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    "اختر الصلاحيات للزبون:",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(Modifier.height(4.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text("إظهار الأسعار")
                    Checkbox(checked = allowPrices, onCheckedChange = { allowPrices = it })
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text("إظهار الكميات")
                    Checkbox(checked = showStock, onCheckedChange = { showStock = it })
                }
            }
        },
        confirmButton = {
            Button(onClick = { onConfirm(allowPrices, showStock) }) {
                Text("منح")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("إلغاء") }
        }
    )
}

/**
 * Returns the catalog base URL — reads from BuildConfig if available,
 * otherwise falls back to the production web URL.
 */
private fun getCatalogBaseUrl(): String =
    try {
        com.inventory.BuildConfig.CATALOG_BASE_URL
    } catch (_: Exception) {
        "https://inventory-web.vercel.app"
    }
