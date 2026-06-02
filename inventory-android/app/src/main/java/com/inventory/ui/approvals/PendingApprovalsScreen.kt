package com.inventory.ui.approvals

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun PendingApprovalsScreen(viewModel: PendingApprovalsViewModel) {
    val approvals by viewModel.approvals.collectAsState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
    ) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("الطلبات المعلقة (${approvals.size})")
            Button(onClick = viewModel::refresh) {
                Text("تحديث")
            }
        }
        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(approvals) { approval ->
                Card {
                    Column(Modifier.padding(12.dp)) {
                        Text("من: ${approval.requesterName}")
                        Text("نوع الطلب: ${approval.requestType}")
                        Text("التاريخ: ${approval.createdAt.orEmpty()}")
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            TextButton(onClick = { viewModel.approve(approval.id) }) {
                                Text("وافق")
                            }
                            TextButton(onClick = { viewModel.reject(approval.id) }) {
                                Text("ارفض")
                            }
                        }
                    }
                }
            }
        }
    }
}
