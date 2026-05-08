# Learning Wiki — Specimen OS

## 🏗️ Architecture: The Spatial Root (Peta Kota)
Specimen OS has transitioned from a flat layout to a **Layered Spatial Architecture**. Imagine the desktop as a city with multiple "floors":
- **Floor 0 (Icon Layer)**: Where the VFS icons live.
- **Floor 10 (Window Management Layer)**: A transparent plane where all applications hover.

By separating these, we ensure that a "building" (maximized window) can cover the entire city block without being restricted by the "sidewalk" (desktop padding).

## 🧠 Technical Decisions (Alasan Meng Mengapa)
### 1. Coordinate Normalization
**Why?** We moved from CSS `top/left` percentages to absolute `x/y` coordinates.
**Analogy**: It's like moving from giving directions as "20% from the west gate" to "exactly at coordinate (450, 300)". This prevents "drift" when the city (viewport) changes size or when we "warp" (maximize) to the origin.

### 2. Pointer Event Sovereignty
**Problem**: Maximized windows were "ghosts" that let you click through to the icons below.
**Fix**: We enforced `pointer-events: auto` on windows and ensured they perfectly "seal" the viewport using `inset-0` with a `-1px` bleed.

## 🖋️ Type Sovereignty: Departure Mono
Specimen OS has transitioned to a **Unified Technical Aesthetic** using [Departure Mono](https://github.com/rektdeckard/departure-mono).
- **Sole Typeface**: Replaced `MS Sans Serif` and `MM205` with Departure Mono for everything (Shell, Content, Branding).
- **Aesthetic Shift**: From pure Win95 emulation to a unique **Specimen Tech Sovereign** identity.
- **Materiality**: The monospaced pixel geometry reinforces the "technical specimen" feel of the application.

## ⚔️ War Stories (Bug & Perbaikan)
### The "Teal Gap" Mystery
**Bug**: A tiny 1px teal line appeared between windows and the taskbar.
**Perbaikan**: Sub-pixel antialiasing was causing a gap. We fixed this by adding a **-1px bottom bleed**, effectively making the window slightly overlap the taskbar's border.
**Lesson**: Sometimes, "Perfectness" requires a tiny, intentional imperfection (overlap).

### The "Control Hijack"
**Bug**: Clicking "Close" or "Maximize" would sometimes drag the window instead.
**Perbaikan**: The title bar was "stealing" the pointer event. We added **Propagation Blocks** (`e.stopPropagation()`) to all controls.
**Lesson**: In a sovereign runtime, always defend your buttons from their parents!

### The "Unified Type" Transition
**Decision**: Moving to a single monospaced font across the entire OS.
**Challenge**: Monospaced fonts take up more horizontal space in menus and title bars.
**Solution**: Adjusted system variables to allow Departure Mono to breathe within the legacy Win95 containers.

## 📜 Wisdom (Pelajaran Berharga)
- **Mechanical Instantaneity**: Win95 isn't about smooth fades; it's about instant material changes. Set `transition: { duration: 0 }` for that authentic technical calm.
- **Z-Index Discipline**: Never use ad-hoc z-indexes. Always rely on the centralized `maxZIndex` state to maintain the stacking order of citizens.

---

## Log Pembaruan: 2026-05-09 (Architectural Audit & Entropy Reduction)

### 🏗️ Arsitektur: Menuju Kedaulatan OS Sejati
Setelah melakukan audit arsitektur komprehensif bergaya Bell Labs, kita menemukan bahwa Specimen OS memiliki pondasi estetika yang kuat namun memiliki hutang struktural (entropy). Sistem saat ini masih terasa seperti aplikasi React raksasa, bukan sebuah sistem operasi.

Kita akan menerapkan **Roadmap Refactor 7-Fase**:
1.  **Naming Legitimacy**: Menyucikan nama variabel dari yang ambigu (`data`, `tmp`) menjadi jelas sesuai niat operasi.
2.  **Comment Legitimacy**: Menghapus komentar yang bersifat dekoratif atau lore-dumping menjadi rationale teknis yang dingin.
3.  **God Component Reduction**: Memecah `Win95Desktop.tsx` yang menangani semua hal (VFS, Window Management, Z-Index) menjadi sub-sistem yang terisolasi.
4.  **Runtime Sovereignty**: Mengkarantina aplikasi (citizen) agar tidak membocorkan state internal mereka ke Shell (pemerintah).
5.  **UI Primitive Normalization**: Menghilangkan prop-drilling di komponen UI.
6.  **State Topology**: Memastikan aliran data deterministik dan presisi.
7.  **Infrastructure Isolation**: Memisahkan API browser agar tidak langsung berinteraksi dengan layer OS.

### 🧠 Keputusan Teknis
**Mengapa membersihkan komponen God (`Win95Desktop`)?**
**Analogi**: Saat ini, walikota (Win95Desktop) secara langsung mengatur lalu lintas jalan, menyalakan lampu jalan, dan membangun rumah warga. Ini membuat kebingungan dan beban berlebih (cognitive overload). Keputusannya adalah mendelegasikan tugas-tugas ini ke dinas yang terpisah (Hooks / State Machines), sehingga walikota hanya fokus pada pandangan tingkat tinggi (orchestration/view rendering).

### 🐛 Cerita Perang: The God Component Tangle
**Kondisi**: Sebuah komponen dengan panjang lebih dari 1000 baris yang memanipulasi z-index secara brute force (`normalizeZIndexes`) untuk memaksa window tampil di depan.
**Pelajaran (Lesson)**: Jika Anda harus menulis fungsi `normalizeX` yang dijalankan secara rekursif atau brute force di setiap render, itu artinya arsitektur state Anda tidak deterministik. Kedaulatan ruang (Spatial Sovereignty) harus teratur, bukan dipaksakan.

---

## Log Pembaruan: 2026-05-09 (Phase 1 - Persistence Deduplication)

### 🧠 Keputusan Teknis: Otoritas Tunggal Penyimpanan Sesi
**Mengapa memisahkan Load dan Save ke dalam hook khusus?**
**Analogi**: Bayangkan memiliki dua pustakawan yang sama-sama mencoba menyusun buku di rak yang sama, di waktu yang sama, tanpa berkomunikasi. Kekacauan (Race condition) pasti terjadi! Dengan memusatkan `loadSessionSnapshot()` dan `useSessionSave()` ke dalam satu otoritas tunggal (Hook `useSessionPersistence`), kita memastikan hanya ada satu "Buku Induk" yang mencatat dan mengembalikan data (Deterministic State).

### 🐛 Cerita Perang: Misteri VFS yang Menghilang
**Bug**: Terkadang file atau pengaturan baru tidak tersimpan jika pengguna melakukan refresh terlalu cepat.
**Penyebab**: Terdapat dua rutinitas penyimpanan yang bersaing (satu berjalan otomatis, satu tertunda 500ms). Rutinitas kedua secara tidak sengaja "lupa" untuk menyimpan sistem file (VFS), sehingga menimpa penyimpanan yang benar dengan penyimpanan tanpa VFS.
**Perbaikan**: Menghapus duplikasi dan menggantinya dengan efek penyimpanan debounced tunggal yang diawasi penuh, memastikan bahwa seluruh topologi (Windows, Recents, VFS) disimpan dalam satu transaksi yang dijamin keamanannya oleh "Hydration Gate" (`mounted`).
**Pelajaran (Lesson)**: Kapanpun sebuah efek (*effect*) React mengakses state yang dinamis, periksa *Dependency Array*. Stale closures (penggunaan data yang usang dalam fungsi) akan menelan data Anda tanpa peringatan!

---

## Log Pembaruan: 2026-05-09 (Phase 2 - Window Manager Extraction)

### 🏗️ Arsitektur: Kedaulatan Tata Kelola Ruang
**Pencabutan Wewenang Desktop (`Win95Desktop`)**
Kita telah melakukan operasi pemisahan wewenang. `Win95Desktop` yang sebelumnya mengatur tata letak, data file (VFS), DAN segala interaksi jendela (Buka, Tutup, Fokus, Z-Index) telah dipreteli. Segala tata kelola ruang dan jendela kini diisolasi ke dalam `useWindowManager`. 
**Analogi**: Kita baru saja mendirikan "Dinas Tata Kota" (`useWindowManager`). Walikota (`Win95Desktop`) kini hanya menerima peta dari dinas tersebut dan menampilkan hasilnya, bukan lagi menggambar peta itu sendiri secara manual setiap detiknya.

### 🧠 Keputusan Teknis: Mutasi State Berbasis Fungsi (Functional Updaters)
**Kenapa beralih dari `setWindows(newWindows)` ke `setWindows(prev => ...)` secara ketat di manajemen Z-Index?**
Manajemen Z-Index adalah operasi matematika yang sangat sensitif terhadap tumpang tindih waktu (race condition). Membaca state, melakukan komputasi, lalu menulisnya kembali sering kali salah karena state asal mungkin sudah kedaluwarsa sebelum penulisan selesai. Penggunaan *functional updater* menjamin bahwa manipulasi array jendela selalu menggunakan data terakurat dan terbaru di detik eksekusi.

### 🐛 Cerita Perang: Tabrakan Normalisasi (The Overwrite Bug)
**Bug**: Saat banyak jendela dibuka hingga indeks Z menembus batas (>800), fungsi fokus tiba-tiba membuat jendela tumpang tindih secara kacau.
**Penyebab**: Fungsi `normalizeZIndexes` memanggil `setWindows` secara sinkron. Namun tepat di baris berikutnya, fungsi `focusWindow` juga memanggil `setWindows`. Pemanggilan kedua menimpa (*overwrite*) hasil komputasi ulang pemanggilan pertama.
**Perbaikan**: Seluruh logika yang melibatkan indeks dinamis Z di `useWindowManager` dipaksa menggunakan *functional updaters*. Dengan demikian React akan mengantrekan perubahan dengan aman tanpa saling menimpa.
**Pelajaran (Lesson)**: Jangan pernah mengandalkan referensi array yang ada di luar *scope* saat Anda melakukan mutasi berturut-turut dalam satu siklus yang sama. Selalu gunakan `setSesuatu(prev => ...)`.

---

## Log Pembaruan: 2026-05-09 (Post-Phase 2 Stabilization & Constitutional Cleanup)

### 🧠 Keputusan Teknis: Otoritas Penamaan dan Komentar (Legitimacy Doctrine)
**Kondisi**: Selama fase refactor, banyak komentar yang merujuk pada "Phase 3" atau menjelaskan proses migrasi ("Hook ini menggantikan pattern lama...").
**Tindakan**: Seluruh narasi migrasi dan referensi roadmap dihapus dari *source code*. Komentar diubah menjadi murni *technical rationale* yang menjelaskan alasan operasional, bukan menceritakan sejarah pengerjaan.
**Pelajaran (Lesson)**: *Production code is an engineering environment, not a narrative space.* Kode yang baik tidak boleh memuat buku harian sang pemrogram. Komentar hanya diizinkan untuk menjelaskan *mengapa* sebuah keputusan teknis dibuat (contoh: "Functional updater memastikan Z-index deterministik").

### 🏗️ Arsitektur: Pengakuan Ketegangan Sementara (Deferred Tension)
**Kondisi**: Logic manajemen untuk jendela aplikasi utama (Desktop Windows) dan jendela Specimen (Special Case) masih terpisah (`maxZIndex` vs `specimenZIndex`).
**Keputusan**: Ketegangan arsitektur ini sengaja *dipertahankan* pada tahap stabilisasi ini. Kita tidak melakukan "over-engineering" untuk menyelesaikan masalah yang merupakan wilayah kerja Phase 3. 
**Pelajaran (Lesson)**: Stabilisasi berarti memastikan apa yang telah dipisahkan berjalan dengan kuat dan berdaulat. Memperbaiki *desain* arsitektural (Phase 3) pada saat stabilisasi (Post-Phase 2) adalah sebuah pelanggaran batasan tugas.
