package com.inventory.ui.navigation

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Inventory2
import androidx.compose.material.icons.filled.ReceiptLong
import androidx.compose.material.icons.filled.WifiOff
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.inventory.ui.approvals.PendingApprovalsScreen
import com.inventory.ui.auth.LoginScreen
import com.inventory.ui.auth.SplashScreen
import com.inventory.ui.customers.AccountLookupScreen
import com.inventory.ui.customers.CustomerDetailScreen
import com.inventory.ui.customers.CustomerFormScreen
import com.inventory.ui.customers.CustomerListScreen
import com.inventory.ui.customers.CustomerStatementScreen
import com.inventory.ui.customers.ReceiptScreen
import com.inventory.ui.dashboard.DashboardScreen
import com.inventory.ui.invoices.InvoiceCreateScreen
import com.inventory.ui.invoices.InvoiceListScreen
import com.inventory.ui.invoices.InvoiceDetailScreen
import com.inventory.ui.vouchers.VoucherCreateScreen
import com.inventory.ui.notifications.NotificationScreen
import com.inventory.ui.products.ProductDetailScreen
import com.inventory.ui.products.ProductFormScreen
import com.inventory.ui.products.ProductListScreen
import com.inventory.ui.products.ProductMovementScreen
import com.inventory.ui.products.QrScannerScreen
import com.inventory.ui.reports.DashboardReportScreen
import com.inventory.ui.reports.ReportsScreen
import com.inventory.ui.settings.SettingsScreen
import com.inventory.ui.users.UserManagementScreen
import com.inventory.ui.catalog.CatalogManagementScreen
import com.inventory.ui.voice.VoiceInvoiceScreen

@Composable
fun InventoryNavHost(shellViewModel: InventoryShellViewModel = hiltViewModel()) {
    val navController = rememberNavController()
    val shellState by shellViewModel.state.collectAsState()
    val backStackEntry by navController.currentBackStackEntryAsState()
    val currentRoute = backStackEntry?.destination?.route
    val showShell = currentRoute !in listOf(Routes.Splash, Routes.Login, Routes.ProductScanner)

    Scaffold(
        topBar = {
            // Offline banner — Zoho amber style
            AnimatedVisibility(visible = showShell && (!shellState.isOnline || shellState.pendingSync > 0)) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .background(Color(0xFFFEF3C7))
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Icon(
                        Icons.Default.WifiOff,
                        contentDescription = null,
                        tint = Color(0xFFB45309),
                        modifier = Modifier.size(16.dp)
                    )
                    Text(
                        text = if (!shellState.isOnline) "أنت offline — البيانات محلية${if (shellState.pendingSync > 0) " | بانتظار المزامنة: ${shellState.pendingSync}" else ""}" else "بانتظار المزامنة: ${shellState.pendingSync}",
                        style = MaterialTheme.typography.labelMedium,
                        color = Color(0xFF92400E)
                    )
                }
            }
        },
        bottomBar = {
            if (showShell) {
                val reportBadge = shellState.unreadNotifications + if (shellState.isAdmin) shellState.pendingApprovals else 0
                NavigationBar(
                    containerColor = MaterialTheme.colorScheme.surface,
                    tonalElevation = 0.dp,
                    modifier = Modifier.navigationBarsPadding()
                ) {
                    listOf(
                        BottomItem("الرئيسية", Routes.Dashboard,  Icons.Default.Home,        0),
                        BottomItem("المخزن",   Routes.Products,   Icons.Default.Inventory2,   0),
                        BottomItem("الفواتير", Routes.Invoices,   Icons.Default.ReceiptLong,  0),
                        BottomItem("الزبائن",  Routes.Customers,  Icons.Default.Groups,       0),
                        BottomItem("التقارير", Routes.Reports,    Icons.Default.BarChart,     reportBadge),
                    ).forEach { item ->
                        NavigationBarItem(
                            selected = currentRoute == item.route,
                            onClick = {
                                navController.navigate(item.route) {
                                    launchSingleTop = true
                                    restoreState = true
                                    popUpTo(navController.graph.startDestinationId) { saveState = true }
                                }
                            },
                            icon = {
                                BadgedBox(
                                    badge = {
                                        if (item.badge > 0)
                                            Badge(containerColor = Color(0xFFDC2626)) {
                                                Text(item.badge.toString(), fontSize = 9.sp)
                                            }
                                    }
                                ) {
                                    Icon(item.icon, contentDescription = item.label)
                                }
                            },
                            label = {
                                Text(
                                    item.label,
                                    style = MaterialTheme.typography.labelSmall
                                )
                            },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor   = MaterialTheme.colorScheme.primary,
                                selectedTextColor   = MaterialTheme.colorScheme.primary,
                                unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
                                unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
                                indicatorColor      = MaterialTheme.colorScheme.primaryContainer,
                            )
                        )
                    }
                }
            }
        }
    ) { padding ->
        Column(Modifier.padding(padding)) {
            NavHost(navController = navController, startDestination = Routes.Splash) {
                composable(Routes.Splash) {
                    SplashScreen(
                        viewModel = hiltViewModel(),
                        onLoggedIn = { navController.navigate(Routes.Dashboard) { popUpTo(Routes.Splash) { inclusive = true } } },
                        onLoginRequired = { navController.navigate(Routes.Login) { popUpTo(Routes.Splash) { inclusive = true } } }
                    )
                }
                composable(Routes.Login) {
                    LoginScreen(
                        viewModel = hiltViewModel(),
                        onLoggedIn = { navController.navigate(Routes.Dashboard) { popUpTo(Routes.Login) { inclusive = true } } }
                    )
                }
                composable(Routes.Dashboard) {
                    DashboardScreen(
                        viewModel = hiltViewModel(),
                        onUsers = { navController.navigate(Routes.Users) },
                        onApprovals = { navController.navigate(Routes.Approvals) },
                        onProducts = { navController.navigate(Routes.Products) },
                        onCustomers = { navController.navigate(Routes.Customers) },
                        onInvoices = { navController.navigate(Routes.Invoices) },
                        onVouchers = { navController.navigate(Routes.VoucherCreate) },
                        onNotifications = { navController.navigate(Routes.Notifications) },
                        onDashboardReport = { navController.navigate(Routes.DashboardReport) },
                        onReports = { navController.navigate(Routes.Reports) },
                        onSettings = { navController.navigate(Routes.Settings) },
                        onAccountLookup = { navController.navigate(Routes.AccountLookup) },
                        onVoiceInvoice  = { navController.navigate(Routes.VoiceInvoice) },
                        onCatalogManagement = { navController.navigate(Routes.CatalogManagement) },
                    )
                }
                composable(Routes.Users) { UserManagementScreen(viewModel = hiltViewModel()) }
                composable(Routes.Approvals) { PendingApprovalsScreen(viewModel = hiltViewModel()) }
                composable(Routes.Products) {
                    ProductListScreen(
                        viewModel = hiltViewModel(),
                        onAdd = { navController.navigate(Routes.productAdd()) },
                        onScan = { navController.navigate(Routes.ProductScanner) },
                        onOpen = { navController.navigate(Routes.productDetail(it)) }
                    )
                }
                composable(Routes.ProductScanner) {
                    QrScannerScreen(
                        viewModel = hiltViewModel(),
                        onOpenProduct = { navController.navigate(Routes.productDetail(it)) },
                        onAddProduct = { navController.navigate(Routes.productAdd(it)) },
                        onAddToInvoice = { productId, unit ->
                            navController.previousBackStackEntry?.savedStateHandle?.set("scannedProductId", productId)
                            navController.previousBackStackEntry?.savedStateHandle?.set("scannedProductUnit", unit)
                            navController.popBackStack()
                        }
                    )
                }
                composable(Routes.ProductScannerInvoice) {
                    QrScannerScreen(
                        viewModel = hiltViewModel(),
                        onOpenProduct = { },
                        onAddProduct = { code -> navController.navigate(Routes.productAdd(code)) },
                        onAddToInvoice = { productId, unit ->
                            navController.previousBackStackEntry?.savedStateHandle?.set("scannedProductId", productId)
                            navController.previousBackStackEntry?.savedStateHandle?.set("scannedProductUnit", unit)
                            navController.popBackStack()
                        },
                        autoAddToInvoice = true
                    )
                }
                composable(Routes.ProductAdd) { ProductFormScreen(viewModel = hiltViewModel(), onDone = { navController.popBackStack() }) }
                composable(Routes.ProductDetail) {
                    ProductDetailScreen(
                        viewModel = hiltViewModel(),
                        onMovement = { navController.navigate(Routes.productMovement(it)) },
                        onAddToInvoice = { navController.navigate(Routes.InvoiceCreate) },
                        onEdit = { navController.navigate(Routes.productEdit(it)) },
                        onBack = { navController.popBackStack() },
                    )
                }
                composable(Routes.ProductEdit) { ProductFormScreen(viewModel = hiltViewModel(), onDone = { navController.popBackStack() }) }
                composable(Routes.ProductMovement) { ProductMovementScreen(viewModel = hiltViewModel(), onOpenInvoice = { }) }
                composable(Routes.Customers) {
                    CustomerListScreen(
                        viewModel = hiltViewModel(),
                        onAdd = { navController.navigate(Routes.CustomerAdd) },
                        onOpen = { navController.navigate(Routes.customerDetail(it)) }
                    )
                }
                composable(Routes.CustomerAdd) { CustomerFormScreen(viewModel = hiltViewModel(), onDone = { navController.popBackStack() }) }
                composable(Routes.CustomerDetail) {
                    CustomerDetailScreen(
                        viewModel = hiltViewModel(),
                        onNewInvoice = { navController.navigate(Routes.InvoiceCreate) },
                        onReceipt = { navController.navigate(Routes.receipt(it)) },
                        onStatement = { navController.navigate(Routes.customerStatement(it)) },
                        onOpenReference = { }
                    )
                }
                composable(Routes.CustomerStatement) {
                    CustomerStatementScreen(
                        viewModel = hiltViewModel(),
                        onOpenReference = { ref ->
                            val parts = ref.split("|")
                            val type = parts.getOrNull(0).orEmpty()
                            val rawId = parts.getOrNull(1).orEmpty()
                            val id = Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
                                .find(rawId)?.value ?: rawId
                            if (type.contains("INVOICE", ignoreCase = true) && id.length == 36) {
                                navController.navigate(Routes.invoiceDetail(id))
                            } else if (id.length == 36) {
                                navController.navigate(Routes.voucherEdit(id))
                            }
                        }
                    )
                }
                composable(Routes.Receipt) { ReceiptScreen(viewModel = hiltViewModel(), onDone = { navController.popBackStack() }) }
                composable(Routes.Invoices) {
                    InvoiceListScreen(
                        viewModel = hiltViewModel(),
                        onCreate = { navController.navigate(Routes.InvoiceCreate) },
                        onOpen = { navController.navigate(Routes.invoiceDetail(it)) }
                    )
                }
                composable(Routes.InvoiceCreate) { backStackEntry ->
                    val invoiceVm: com.inventory.ui.invoices.InvoiceCreateViewModel = hiltViewModel()
                    val scannedProductId by backStackEntry.savedStateHandle
                        .getStateFlow("scannedProductId", "")
                        .collectAsState()
                    val scannedProductUnit by backStackEntry.savedStateHandle
                        .getStateFlow("scannedProductUnit", "PIECE")
                        .collectAsState()
                    LaunchedEffect(scannedProductId, scannedProductUnit) {
                        if (scannedProductId.isNotBlank()) {
                            invoiceVm.addProductById(scannedProductId, scannedProductUnit)
                            backStackEntry.savedStateHandle["scannedProductId"] = ""
                            backStackEntry.savedStateHandle["scannedProductUnit"] = "PIECE"
                        }
                    }
                    InvoiceCreateScreen(
                        viewModel = invoiceVm,
                        onDone = { navController.navigate(Routes.invoiceDetail(it)) },
                        onScanQr = { navController.navigate(Routes.ProductScannerInvoice) },
                        onAddCustomer = { navController.navigate(Routes.CustomerAdd) },
                        onAddProduct = { navController.navigate(Routes.productAdd(name = it)) }
                    )
                }
                composable(Routes.InvoiceDetail) { backStackEntry ->
                    val id = backStackEntry.arguments?.getString("invoiceId") ?: ""
                    InvoiceDetailScreen(
                        invoiceId = id,
                        viewModel = hiltViewModel(),
                        onBack = { navController.popBackStack() },
                        onEdit = { navController.navigate(Routes.invoiceEdit(it)) }
                    )
                }
                composable(Routes.InvoiceEdit) { backStackEntry ->
                    val id = backStackEntry.arguments?.getString("invoiceId") ?: ""
                    val invoiceVm: com.inventory.ui.invoices.InvoiceCreateViewModel = hiltViewModel()
                    val scannedProductId by backStackEntry.savedStateHandle
                        .getStateFlow("scannedProductId", "")
                        .collectAsState()
                    val scannedProductUnit by backStackEntry.savedStateHandle
                        .getStateFlow("scannedProductUnit", "PIECE")
                        .collectAsState()
                    LaunchedEffect(scannedProductId, scannedProductUnit) {
                        if (scannedProductId.isNotBlank()) {
                            invoiceVm.addProductById(scannedProductId, scannedProductUnit)
                            backStackEntry.savedStateHandle["scannedProductId"] = ""
                            backStackEntry.savedStateHandle["scannedProductUnit"] = "PIECE"
                        }
                    }
                    InvoiceCreateScreen(
                        viewModel = invoiceVm,
                        invoiceId = id,
                        onDone = { navController.navigate(Routes.invoiceDetail(it)) },
                        onScanQr = { navController.navigate(Routes.ProductScannerInvoice) },
                        onAddCustomer = { navController.navigate(Routes.CustomerAdd) },
                        onAddProduct = { navController.navigate(Routes.productAdd(name = it)) },
                        onBack = { navController.popBackStack() }
                    )
                }
                composable(Routes.VoucherCreate) {
                    VoucherCreateScreen(viewModel = hiltViewModel(), onBack = { navController.popBackStack() })
                }
                composable(Routes.VoucherEdit) { backStackEntry ->
                    val id = backStackEntry.arguments?.getString("voucherId") ?: ""
                    VoucherCreateScreen(viewModel = hiltViewModel(), voucherId = id, onBack = { navController.popBackStack() })
                }
                composable(Routes.Notifications) {
                    NotificationScreen(viewModel = hiltViewModel(), onBack = { navController.popBackStack() })
                }
                composable(Routes.VoiceInvoice) {
                    VoiceInvoiceScreen(
                        onNavigateToInvoice = { id ->
                            navController.navigate(Routes.invoiceDetail(id))
                        },
                        onBack = { navController.popBackStack() },
                        viewModel = hiltViewModel(),
                    )
                }
                composable(Routes.CatalogManagement) {
                    CatalogManagementScreen(
                        viewModel = hiltViewModel(),
                        onBack = { navController.popBackStack() }
                    )
                }
                composable(Routes.DashboardReport) { DashboardReportScreen(viewModel = hiltViewModel()) }
                composable(Routes.Reports) { ReportsScreen(viewModel = hiltViewModel()) }
                composable(Routes.Settings) { SettingsScreen(viewModel = hiltViewModel()) }
                composable(Routes.AccountLookup) {
                    AccountLookupScreen(
                        viewModel = hiltViewModel(),
                        onStatement = { navController.navigate(Routes.customerStatement(it)) },
                        onBack = { navController.popBackStack() }
                    )
                }
            }
        }
    }
}

private data class BottomItem(
    val label: String,
    val route: String,
    val icon: ImageVector,
    val badge: Int
)
