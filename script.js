/**
 * script.js - Core Frontend Logic untuk SekolahUjian SMK
 * Mengelola state, sinkronisasi backend GAS, validasi ujian, anti-kecurangan, dan impor/ekspor.
 */

// ==========================================================================
// 1. STATE MANAGEMENT APLIKASI
// ==========================================================================
const AppState = {
  currentRole: 'guru', // 'guru' atau 'siswa'
  gasEndpoint: '',
  gasToken: '',
  
  // Data Master (Guru/Admin Side)
  kelas: [],
  siswa: [],
  bankSoal: [],
  hasilUjian: [],
  
  // Data Runtime Ujian (Siswa Side)
  activeExam: {
    judul: "Ujian Kompetensi Keahlian SMK",
    durasiMenit: 60,
    soal: [],
    jawabanSiswa: {}, // Format: { soalId: "A" }
    statusRagu: {},    // Format: { soalId: true/false }
    currentIndex: 0,
    timerInterval: null,
    sisaDetik: 0,
    pelanggaranCount: 0
  },
  
  // Data Siswa Aktif
  activeStudent: {
    nis: '',
    nama: '',
    kelasId: ''
  }
};

// ==========================================================================
// 2. INITIALIZATION & ROUTING EVENT LISTENERS
// ==========================================================================
document.addEventListener('DOMContentLoaded', () => {
  initConfiguration();
  setupRoleSwitcher();
  setupNavigationGuru();
  setupFormEventListeners();
  setupExamEventListeners();
  setupSecurityListeners();
  
  // Load data awal dari LocalStorage jika ada endpoint yang tersimpan
  if (AppState.gasEndpoint) {
    refreshGuruDashboardData();
  }
});

/**
 * Membaca konfigurasi awal dari tag JSON di HTML
 */
function initConfiguration() {
  const configEl = document.getElementById('app-config');
  if (configEl) {
    try {
      const config = JSON.parse(configEl.textContent);
      AppState.gasEndpoint = localStorage.getItem('sekolahujian_gas_url') || config.gasEndpointUrl || '';
      AppState.gasToken = localStorage.getItem('sekolahujian_gas_token') || '';
      
      // Update UI Status Endpoint di footer
      updateEndpointStatusUI();
    } catch (e) {
      console.error('Gagal memuat elemen app-config:', e);
    }
  }
}

function updateEndpointStatusUI() {
  const statusTexts = ['guru-info-endpoint', 'footer-endpoint-status'];
  statusTexts.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = AppState.gasEndpoint 
        ? `Endpoint GAS: Aktif (${AppState.gasEndpoint.substring(0, 30)}...)` 
        : 'Endpoint GAS: belum diatur';
    }
  });
  
  // Set value pada input dialog modal jika dibuka
  const inputUrl = document.getElementById('input-gas-endpoint');
  const inputTok = document.getElementById('input-gas-token');
  if (inputUrl) inputUrl.value = AppState.gasEndpoint;
  if (inputTok) inputTok.value = AppState.gasToken;
}

// ==========================================================================
// 3. KOMUNIKASI ASINKRON (BACKEND INTEGRATION)
// ==========================================================================
/**
 * Driver fetch universal terenkapsulasi untuk berkomunikasi ke Google Apps Script Web App
 */
async function gasFetch(path, payload = {}) {
  if (!AppState.gasEndpoint) {
    throw new Error('URL Endpoint Google Apps Script belum dikonfigurasi. Klik tombol ⚙️ Endpoint GAS.');
  }

  // Menambahkan token keamanan ke payload jika dikonfigurasi
  const securePayload = {
    path: path,
    clientToken: AppState.gasToken,
    payload: payload
  };

  try {
    const response = await fetch(AppState.gasEndpoint, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8' // Menghindari preflight OPTIONS CORS berlebih pada GAS
      },
      body: JSON.stringify(securePayload)
    });

    if (!response.ok) {
      throw new Error(`HTTP Error! Status: ${response.status}`);
    }

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.message || result.error || 'Terjadi kesalahan sistem internal peladen.');
    }
    return result;
  } catch (error) {
    console.error(`GAS Fetch Error [${path}]:`, error);
    throw error;
  }
}

// ==========================================================================
// 4. SWITCHER PERAN & NAVIGASI
// ==========================================================================
function setupRoleSwitcher() {
  const btnGuru = document.getElementById('role-switch-guru');
  const btnSiswa = document.getElementById('role-switch-siswa');
  const viewGuru = document.getElementById('guru-view');
  const viewSiswa = document.getElementById('siswa-view');

  btnGuru.addEventListener('click', () => {
    switchRole('guru', btnGuru, btnSiswa, viewGuru, viewSiswa);
  });

  btnSiswa.addEventListener('click', () => {
    switchRole('siswa', btnSiswa, btnGuru, viewSiswa, viewGuru);
  });
}

function switchRole(role, activeBtn, inactiveBtn, activeView, inactiveView) {
  AppState.currentRole = role;
  
  activeBtn.classList.add('active');
  activeBtn.setAttribute('aria-selected', 'true');
  inactiveBtn.classList.remove('active');
  inactiveBtn.setAttribute('aria-selected', 'false');
  
  activeView.classList.add('active');
  activeView.removeAttribute('hidden');
  inactiveView.classList.remove('active');
  inactiveView.setAttribute('hidden', '');
  
  if (role === 'guru') {
    refreshGuruDashboardData();
  }
}

function setupNavigationGuru() {
  const navItems = document.querySelectorAll('#guru-nav .nav-item');
  const panels = document.querySelectorAll('#guru-content .panel');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      navItems.forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');

      const targetPanelId = item.getAttribute('data-panel');
      panels.forEach(panel => {
        if (panel.id === targetPanelId) {
          panel.classList.add('active');
          panel.removeAttribute('hidden');
        } else {
          panel.classList.remove('active');
          panel.setAttribute('hidden', '');
        }
      });
      
      // Hook trigger reload data spesifik saat panel dibuka
      handlePanelFocus(targetPanelId);
    });
  });
}

function handlePanelFocus(panelId) {
  if (!AppState.gasEndpoint) return;
  
  switch(panelId) {
    case 'panel-kelas': fetchListKelas(); break;
    case 'panel-siswa': fetchListSiswa(); fetchListKelas(); break;
    case 'panel-bank-soal': fetchListBankSoal(); break;
    case 'panel-buat-ujian': fetchListBankSoal(); renderUjianSoalSelector(); break;
    case 'panel-hasil': fetchListHasilUjian(); break;
  }
}

// ==========================================================================
// 5. MANAJEMEN DATA GURU (KELAS, SISWA, BANK SOAL)
// ==========================================================================
function setupFormEventListeners() {
  // Modal Dialog Endpoint GAS
  const btnOpenSettings = document.getElementById('btn-open-gas-settings');
  const dialogGas = document.getElementById('dialog-gas-endpoint');
  const btnCloseGas = document.getElementById('btn-dialog-gas-close');
  const formGas = document.getElementById('form-gas-endpoint');
  const btnTestGas = document.getElementById('btn-gas-test');

  btnOpenSettings.addEventListener('click', () => dialogGas.showModal());
  btnCloseGas.addEventListener('click', () => dialogGas.close());
  
  formGas.addEventListener('submit', (e) => {
    e.preventDefault();
    const urlValue = document.getElementById('input-gas-endpoint').value.trim();
    const tokenValue = document.getElementById('input-gas-token').value.trim();
    
    AppState.gasEndpoint = urlValue;
    AppState.gasToken = tokenValue;
    localStorage.setItem('sekolahujian_gas_url', urlValue);
    localStorage.setItem('sekolahujian_gas_token', tokenValue);
    
    updateEndpointStatusUI();
    dialogGas.close();
    refreshGuruDashboardData();
  });

  btnTestGas.addEventListener('click', async () => {
    const errorEl = document.getElementById('error-gas-endpoint');
    errorEl.textContent = 'Menghubungkan...';
    errorEl.style.color = 'var(--warning)';
    try {
      // Test hit endpoint kelas list
      await gasFetch('/kelas/list');
      errorEl.textContent = 'Koneksi Sukses! Endpoint valid.';
      errorEl.style.color = 'var(--success)';
    } catch (err) {
      errorEl.textContent = 'Koneksi Gagal: ' + err.message;
      errorEl.style.color = 'var(--danger)';
    }
  });

  // Simpan Kelas
  document.getElementById('btn-kelas-simpan').addEventListener('click', async () => {
    const nama = document.getElementById('input-kelas-nama').value.trim();
    const jurusan = document.getElementById('input-kelas-jurusan').value.trim();
    const tahun = document.getElementById('input-kelas-tahun').value.trim();
    const errorEl = document.getElementById('error-kelas');

    if (!nama) { errorEl.textContent = 'Nama Kelas wajib diisi!'; return; }
    
    try {
      await gasFetch('/kelas/simpan', { nama, jurusan, tahunAjaran: tahun, waliKelas: jurusan });
      document.getElementById('input-kelas-nama').value = '';
      errorEl.textContent = 'Kelas berhasil disimpan!';
      errorEl.style.color = 'var(--success)';
      fetchListKelas();
    } catch(err) {
      errorEl.textContent = err.message;
    }
  });

  // Simpan Siswa
  document.getElementById('btn-siswa-simpan').addEventListener('click', async () => {
    const nis = document.getElementById('input-siswa-nis').value.trim();
    const nama = document.getElementById('input-siswa-nama').value.trim();
    const kelasId = document.getElementById('select-siswa-kelas').value;
    const errorEl = document.getElementById('error-siswa');

    if (!nis || !nama || !kelasId) { errorEl.textContent = 'Semua field wajib diisi!'; return; }

    try {
      await gasFetch('/siswa/simpan', { id: nis, nama, kelasId, jenisKelamin: 'L/P' });
      document.getElementById('input-siswa-nis').value = '';
      document.getElementById('input-siswa-nama').value = '';
