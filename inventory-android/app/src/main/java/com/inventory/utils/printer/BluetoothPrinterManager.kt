package com.inventory.utils.printer

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothManager
import android.content.Context
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.io.OutputStream
import java.util.UUID

class BluetoothPrinterManager(private val context: Context) {
    private val bluetoothAdapter: BluetoothAdapter? by lazy {
        val bluetoothManager = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
        bluetoothManager.adapter
    }

    // Standard UUID for SPP (Serial Port Profile) used by thermal printers
    private val PRINTER_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805f9b34fb")

    @SuppressLint("MissingPermission")
    fun getPairedPrinters(): List<BluetoothDevice> {
        val pairedDevices = bluetoothAdapter?.bondedDevices
        return pairedDevices?.toList() ?: emptyList()
    }

    @SuppressLint("MissingPermission")
    suspend fun print(device: BluetoothDevice, bytes: ByteArray): Boolean = withContext(Dispatchers.IO) {
        try {
            val socket = device.createRfcommSocketToServiceRecord(PRINTER_UUID)
            socket.connect()
            val outputStream: OutputStream = socket.outputStream
            
            // Send the raw bytes
            outputStream.write(bytes)
            outputStream.flush()
            
            // Allow buffer to empty — use coroutine delay (not Thread.sleep) to free the IO thread
            delay(1000)
            socket.close()
            true
        } catch (e: Exception) {
            Log.e("BluetoothPrinter", "Error printing: ${e.message}")
            false
        }
    }
}
