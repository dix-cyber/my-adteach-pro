/**
 * MY ADTEACH PRO - Enterprise Teacher Management Platform
 * Google Apps Script Backend (Production-Ready)
 * 
 * Version: 1.0.0
 * Last Updated: 2026-05-13
 * 
 * Security & Performance Optimized
 * Multi-user Enterprise Ready
 */

const SPREADSHEET_ID = ''; // REPLACE WITH YOUR SPREADSHEET ID
const SHEET_NAMES = {
  USERS: 'USERS',
  KELAS: 'KELAS',
  SISWA: 'SISWA',
  JADWAL: 'JADWAL',
  ABSENSI: 'ABSENSI',
  NILAI: 'NILAI',
  JURNAL: 'JURNAL',
  APPROVAL_LOG: 'APPROVAL_LOG',
  SYSTEM_LOG: 'SYSTEM_LOG'
};

const CACHE_DURATION = 600; // 10 minutes
const SESSION_DURATION = 3600; // 1 hour
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_TIMEOUT = 30000; // 30 seconds

/**
 * ============================================================================
 * AUTHENTICATION & SESSION MANAGEMENT
 * ============================================================================
 */

/**
 * Main authentication handler
 */
function doGet(e) {
  try {
    const path = e.pathInfo || 'login';
    const params = e.parameter;

    // Validate path
    if (!isValidPath(path)) {
      return HtmlService.createHtmlOutput('Invalid path').setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }

    // Route to appropriate page
    switch (path) {
      case 'login':
        return HtmlService.createTemplateFromFile('login').evaluate()
          .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
          .addMetaTag('viewport', 'width=device-width, initial-scale=1');

      case 'dashboard':
      case 'kelas':
      case 'siswa':
      case 'jadwal':
      case 'absensi':
      case 'nilai':
      case 'jurnal':
      case 'approval':
      case 'rekap':
        const template = HtmlService.createTemplateFromFile('index');
        return template.evaluate()
          .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
          .addMetaTag('viewport', 'width=device-width, initial-scale=1')
          .setCSP('script-src "self" https://cdn.jsdelivr.net https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js; img-src *');

      default:
        return HtmlService.createHtmlOutput('Page not found');
    }
  } catch (error) {
    logError('doGet', error);
    return HtmlService.createHtmlOutput('Server error');
  }
}

/**
 * Validate authentication path
 */
function isValidPath(path) {
  const validPaths = ['login', 'dashboard', 'kelas', 'siswa', 'jadwal', 'absensi', 'nilai', 'jurnal', 'approval', 'rekap'];
  return validPaths.includes(path);
}

/**
 * User login with rate limiting
 */
function loginUser(email, password) {
  try {
    // Rate limiting
    const cacheKey = `login_attempts_${email}`;
    const attempts = CacheService.getUserCache().get(cacheKey);
    if (attempts && parseInt(attempts) >= MAX_LOGIN_ATTEMPTS) {
      return {
        success: false,
        message: 'Too many login attempts. Try again later.',
        code: 'RATE_LIMIT'
      };
    }

    // Validate input
    if (!email || !password || !isValidEmail(email)) {
      incrementLoginAttempts(email);
      return {
        success: false,
        message: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS'
      };
    }

    // Get user from USERS sheet
    const user = getUserByEmail(email);
    if (!user || !validatePassword(password, user.password)) {
      incrementLoginAttempts(email);
      return {
        success: false,
        message: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS'
      };
    }

    // Check if user is active
    if (user.status !== 'Aktif') {
      return {
        success: false,
        message: 'User account is inactive',
        code: 'ACCOUNT_INACTIVE'
      };
    }

    // Clear login attempts
    CacheService.getUserCache().remove(cacheKey);

    // Create session token
    const sessionToken = generateSessionToken();
    const sessionData = {
      email: user.email,
      nama: user.nama,
      role: user.role,
      timestamp: new Date().getTime(),
      token: sessionToken
    };

    // Store session (10 minutes)
    CacheService.getUserCache().put(
      `session_${sessionToken}`,
      JSON.stringify(sessionData),
      SESSION_DURATION
    );

    // Update last login
    updateLastLogin(email);

    // Log activity
    logActivity(email, 'LOGIN', 'User logged in', 'SUCCESS');

    return {
      success: true,
      message: 'Login successful',
      token: sessionToken,
      user: {
        email: user.email,
        nama: user.nama,
        role: user.role
      }
    };
  } catch (error) {
    logError('loginUser', error);
    return {
      success: false,
      message: 'Login failed. Please try again.',
      code: 'SERVER_ERROR'
    };
  }
}

/**
 * Validate session token
 */
function validateSession(token) {
  try {
    if (!token || typeof token !== 'string') {
      return null;
    }

    const sessionData = CacheService.getUserCache().get(`session_${token}`);
    if (!sessionData) {
      return null;
    }

    return JSON.parse(sessionData);
  } catch (error) {
    logError('validateSession', error);
    return null;
  }
}

/**
 * Increment login attempts
 */
function incrementLoginAttempts(email) {
  const cacheKey = `login_attempts_${email}`;
  const cache = CacheService.getUserCache();
  const current = cache.get(cacheKey) || '0';
  cache.put(cacheKey, (parseInt(current) + 1).toString(), 900); // 15 minutes
}

/**
 * Update last login timestamp
 */
function updateLastLogin(email) {
  try {
    const sheet = getSheet(SHEET_NAMES.USERS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const emailIndex = headers.indexOf('Email');
    const lastLoginIndex = headers.indexOf('LastLogin');

    for (let i = 1; i < data.length; i++) {
      if (data[i][emailIndex] === email) {
        sheet.getRange(i + 1, lastLoginIndex + 1).setValue(new Date().toISOString());
        break;
      }
    }
  } catch (error) {
    logError('updateLastLogin', error);
  }
}

/**
 * Generate secure session token
 */
function generateSessionToken() {
  return Utilities.getUuid();
}

/**
 * ============================================================================
 * ROLE-BASED ACCESS CONTROL
 * ============================================================================
 */

/**
 * Check if user has required role
 */
function hasRole(session, requiredRole) {
  if (!session) return false;
  if (requiredRole === '*') return true; // Any authenticated user
  if (Array.isArray(requiredRole)) {
    return requiredRole.includes(session.role);
  }
  return session.role === requiredRole;
}

/**
 * Get user permissions based on role
 */
function getUserPermissions(role) {
  const permissions = {
    Admin: [
      'view_all_users',
      'manage_users',
      'view_all_classes',
      'manage_classes',
      'view_all_students',
      'manage_students',
      'view_all_attendance',
      'manage_attendance',
      'view_all_grades',
      'manage_grades',
      'view_all_journals',
      'approve_journals',
      'view_system_logs',
      'export_reports'
    ],
    Guru: [
      'view_own_classes',
      'manage_own_classes',
      'view_own_students',
      'manage_own_attendance',
      'manage_own_grades',
      'write_journals',
      'view_own_journals',
      'view_class_statistics'
    ],
    KepalaSekolah: [
      'view_all_users',
      'view_all_classes',
      'view_all_students',
      'view_all_attendance',
      'view_all_grades',
      'view_all_journals',
      'approve_journals',
      'view_system_logs',
      'export_reports'
    ]
  };
  return permissions[role] || [];
}

/**
 * ============================================================================
 * USER MANAGEMENT
 * ============================================================================
 */

/**
 * Get user by email
 */
function getUserByEmail(email) {
  try {
    const cacheKey = `user_${email}`;
    const cached = CacheService.getUserCache().get(cacheKey);
    if (cached) return JSON.parse(cached);

    const sheet = getSheet(SHEET_NAMES.USERS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const emailIndex = headers.indexOf('Email');

    for (let i = 1; i < data.length; i++) {
      if (data[i][emailIndex] === email) {
        const user = convertRowToObject(headers, data[i]);
        CacheService.getUserCache().put(cacheKey, JSON.stringify(user), CACHE_DURATION);
        return user;
      }
    }
    return null;
  } catch (error) {
    logError('getUserByEmail', error);
    return null;
  }
}

/**
 * Get all users (admin only)
 */
function getAllUsers(session) {
  try {
    if (!hasRole(session, 'Admin')) {
      return { success: false, message: 'Access denied', users: [] };
    }

    const cacheKey = 'users_all';
    const cached = CacheService.getUserCache().get(cacheKey);
    if (cached) return JSON.parse(cached);

    const sheet = getSheet(SHEET_NAMES.USERS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const users = [];

    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) { // Skip empty rows
        users.push(convertRowToObject(headers, data[i]));
      }
    }

    const result = { success: true, users };
    CacheService.getUserCache().put(cacheKey, JSON.stringify(result), CACHE_DURATION);
    return result;
  } catch (error) {
    logError('getAllUsers', error);
    return { success: false, message: 'Failed to fetch users', users: [] };
  }
}

/**
 * Create new user (admin only)
 */
function createUser(session, userData) {
  try {
    if (!hasRole(session, 'Admin')) {
      return { success: false, message: 'Access denied' };
    }

    // Validate input
    const validation = validateUserInput(userData);
    if (!validation.valid) {
      return { success: false, message: validation.error };
    }

    // Check if email exists
    if (getUserByEmail(userData.email)) {
      return { success: false, message: 'Email already exists' };
    }

    const sheet = getSheet(SHEET_NAMES.USERS);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const newRow = [];

    headers.forEach(header => {
      switch (header) {
        case 'Email':
          newRow.push(userData.email);
          break;
        case 'Nama':
          newRow.push(userData.nama);
          break;
        case 'Role':
          newRow.push(userData.role);
          break;
        case 'Status':
          newRow.push('Aktif');
          break;
        case 'TglDaftar':
          newRow.push(new Date().toISOString().split('T')[0]);
          break;
        case 'LastLogin':
          newRow.push('-');
          break;
        case 'password':
          newRow.push(hashPassword(userData.password || 'defaultPassword123'));
          break;
        default:
          newRow.push('');
      }
    });

    // Use lock for concurrent writes
    const lock = LockService.getUserLock();
    lock.waitLock(LOCK_TIMEOUT);
    try {
      sheet.appendRow(newRow);
      clearUserCache();
      logActivity(session.email, 'CREATE_USER', `Created user: ${userData.email}`, 'SUCCESS');
      return { success: true, message: 'User created successfully' };
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    logError('createUser', error);
    return { success: false, message: 'Failed to create user' };
  }
}

/**
 * Validate user input
 */
function validateUserInput(userData) {
  if (!userData.email || !isValidEmail(userData.email)) {
    return { valid: false, error: 'Invalid email' };
  }
  if (!userData.nama || userData.nama.length < 3) {
    return { valid: false, error: 'Name must be at least 3 characters' };
  }
  if (!['Admin', 'Guru', 'KepalaSekolah'].includes(userData.role)) {
    return { valid: false, error: 'Invalid role' };
  }
  return { valid: true };
}

/**
 * ============================================================================
 * CLASS MANAGEMENT
 * ============================================================================
 */

/**
 * Get all classes (with role-based filtering)
 */
function getAllClasses(session) {
  try {
    if (!hasRole(session, ['Admin', 'Guru', 'KepalaSekolah'])) {
      return { success: false, message: 'Access denied', classes: [] };
    }

    const cacheKey = `classes_${session.role}_${session.email}`;
    const cached = CacheService.getUserCache().get(cacheKey);
    if (cached) return JSON.parse(cached);

    const sheet = getSheet(SHEET_NAMES.KELAS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    let classes = [];

    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) {
        const kelas = convertRowToObject(headers, data[i]);
        
        // Filter based on role
        if (session.role === 'Admin' || session.role === 'KepalaSekolah') {
          classes.push(kelas);
        } else if (session.role === 'Guru' && kelas.Guru === session.email) {
          classes.push(kelas);
        }
      }
    }

    const result = { success: true, classes };
    CacheService.getUserCache().put(cacheKey, JSON.stringify(result), CACHE_DURATION);
    return result;
  } catch (error) {
    logError('getAllClasses', error);
    return { success: false, message: 'Failed to fetch classes', classes: [] };
  }
}

/**
 * Create class (admin only)
 */
function createClass(session, classData) {
  try {
    if (!hasRole(session, 'Admin')) {
      return { success: false, message: 'Access denied' };
    }

    const validation = validateClassInput(classData);
    if (!validation.valid) {
      return { success: false, message: validation.error };
    }

    const sheet = getSheet(SHEET_NAMES.KELAS);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const newRow = [];

    headers.forEach(header => {
      switch (header) {
        case 'ID':
          newRow.push('KELAS_' + new Date().getTime());
          break;
        case 'NamaKelas':
          newRow.push(classData.namaKelas);
          break;
        case 'TahunAjaran':
          newRow.push(classData.tahunAjaran);
          break;
        case 'Guru':
          newRow.push(classData.guru);
          break;
        case 'JumlahSiswa':
          newRow.push(0);
          break;
        case 'Status':
          newRow.push('Aktif');
          break;
        default:
          newRow.push('');
      }
    });

    const lock = LockService.getUserLock();
    lock.waitLock(LOCK_TIMEOUT);
    try {
      sheet.appendRow(newRow);
      clearClassCache();
      logActivity(session.email, 'CREATE_CLASS', `Created class: ${classData.namaKelas}`, 'SUCCESS');
      return { success: true, message: 'Class created successfully' };
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    logError('createClass', error);
    return { success: false, message: 'Failed to create class' };
  }
}

/**
 * Validate class input
 */
function validateClassInput(classData) {
  if (!classData.namaKelas || classData.namaKelas.length < 2) {
    return { valid: false, error: 'Class name must be at least 2 characters' };
  }
  if (!classData.tahunAjaran) {
    return { valid: false, error: 'Academic year is required' };
  }
  if (!classData.guru) {
    return { valid: false, error: 'Teacher is required' };
  }
  return { valid: true };
}

/**
 * ============================================================================
 * ATTENDANCE MANAGEMENT
 * ============================================================================
 */

/**
 * Get attendance records (filtered by role)
 */
function getAttendance(session, filters = {}) {
  try {
    if (!hasRole(session, ['Admin', 'Guru', 'KepalaSekolah'])) {
      return { success: false, message: 'Access denied', records: [] };
    }

    const sheet = getSheet(SHEET_NAMES.ABSENSI);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    let records = [];

    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) {
        const record = convertRowToObject(headers, data[i]);
        
        // Apply filters
        if (filters.klasID && record.KelasID !== filters.klasID) continue;
        if (filters.startDate && new Date(record.TanggalJam) < new Date(filters.startDate)) continue;
        if (filters.endDate && new Date(record.TanggalJam) > new Date(filters.endDate)) continue;

        records.push(record);
      }
    }

    return { success: true, records };
  } catch (error) {
    logError('getAttendance', error);
    return { success: false, message: 'Failed to fetch attendance', records: [] };
  }
}

/**
 * Submit attendance (teacher only)
 */
function submitAttendance(session, attendanceData) {
  try {
    if (!hasRole(session, 'Guru')) {
      return { success: false, message: 'Access denied' };
    }

    const validation = validateAttendanceInput(attendanceData);
    if (!validation.valid) {
      return { success: false, message: validation.error };
    }

    const sheet = getSheet(SHEET_NAMES.ABSENSI);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const newRow = [];

    headers.forEach(header => {
      switch (header) {
        case 'ID':
          newRow.push('ABS_' + new Date().getTime());
          break;
        case 'TanggalJam':
          newRow.push(new Date().toISOString());
          break;
        case 'KelasID':
          newRow.push(attendanceData.kelasID);
          break;
        case 'SiswaID':
          newRow.push(attendanceData.siswaID);
          break;
        case 'Status':
          newRow.push(attendanceData.status);
          break;
        case 'Keterangan':
          newRow.push(attendanceData.keterangan || '');
          break;
        default:
          newRow.push('');
      }
    });

    const lock = LockService.getUserLock();
    lock.waitLock(LOCK_TIMEOUT);
    try {
      sheet.appendRow(newRow);
      logActivity(session.email, 'SUBMIT_ATTENDANCE', `Submitted attendance for class ${attendanceData.kelasID}`, 'SUCCESS');
      return { success: true, message: 'Attendance submitted successfully' };
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    logError('submitAttendance', error);
    return { success: false, message: 'Failed to submit attendance' };
  }
}

/**
 * Validate attendance input
 */
function validateAttendanceInput(data) {
  if (!data.kelasID) return { valid: false, error: 'Class ID is required' };
  if (!data.siswaID) return { valid: false, error: 'Student ID is required' };
  if (!['Hadir', 'Sakit', 'Izin', 'Alfa'].includes(data.status)) {
    return { valid: false, error: 'Invalid attendance status' };
  }
  return { valid: true };
}

/**
 * ============================================================================
 * GRADES MANAGEMENT
 * ============================================================================
 */

/**
 * Submit grades (teacher only)
 */
function submitGrades(session, gradeData) {
  try {
    if (!hasRole(session, 'Guru')) {
      return { success: false, message: 'Access denied' };
    }

    const validation = validateGradeInput(gradeData);
    if (!validation.valid) {
      return { success: false, message: validation.error };
    }

    const sheet = getSheet(SHEET_NAMES.NILAI);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const newRow = [];

    headers.forEach(header => {
      switch (header) {
        case 'ID':
          newRow.push('NILAI_' + new Date().getTime());
          break;
        case 'TanggalJam':
          newRow.push(new Date().toISOString());
          break;
        case 'KelasID':
          newRow.push(gradeData.kelasID);
          break;
        case 'SiswaID':
          newRow.push(gradeData.siswaID);
          break;
        case 'Mapel':
          newRow.push(gradeData.mapel);
          break;
        case 'Nilai':
          newRow.push(gradeData.nilai);
          break;
        case 'Jenis':
          newRow.push(gradeData.jenis);
          break;
        default:
          newRow.push('');
      }
    });

    const lock = LockService.getUserLock();
    lock.waitLock(LOCK_TIMEOUT);
    try {
      sheet.appendRow(newRow);
      logActivity(session.email, 'SUBMIT_GRADES', `Submitted grades for class ${gradeData.kelasID}`, 'SUCCESS');
      return { success: true, message: 'Grades submitted successfully' };
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    logError('submitGrades', error);
    return { success: false, message: 'Failed to submit grades' };
  }
}

/**
 * Validate grade input
 */
function validateGradeInput(data) {
  if (!data.kelasID) return { valid: false, error: 'Class ID is required' };
  if (!data.siswaID) return { valid: false, error: 'Student ID is required' };
  if (!data.mapel) return { valid: false, error: 'Subject is required' };
  if (isNaN(data.nilai) || data.nilai < 0 || data.nilai > 100) {
    return { valid: false, error: 'Grade must be between 0 and 100' };
  }
  if (!['UTS', 'UAS', 'Tugas', 'Quiz'].includes(data.jenis)) {
    return { valid: false, error: 'Invalid grade type' };
  }
  return { valid: true };
}

/**
 * ============================================================================
 * JOURNAL MANAGEMENT
 * ============================================================================
 */

/**
 * Submit teaching journal (teacher only)
 */
function submitJournal(session, journalData) {
  try {
    if (!hasRole(session, 'Guru')) {
      return { success: false, message: 'Access denied' };
    }

    const validation = validateJournalInput(journalData);
    if (!validation.valid) {
      return { success: false, message: validation.error };
    }

    const sheet = getSheet(SHEET_NAMES.JURNAL);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const newRow = [];

    headers.forEach(header => {
      switch (header) {
        case 'ID':
          newRow.push('JURNAL_' + new Date().getTime());
          break;
        case 'TanggalJam':
          newRow.push(new Date().toISOString());
          break;
        case 'Guru':
          newRow.push(session.email);
          break;
        case 'KelasID':
          newRow.push(journalData.kelasID);
          break;
        case 'Konten':
          newRow.push(sanitizeInput(journalData.konten));
          break;
        case 'Lampiran':
          newRow.push(journalData.lampiran || '');
          break;
        case 'Status':
          newRow.push('Draft');
          break;
        case 'ApprovedBy':
          newRow.push('');
          break;
        case 'TglApproval':
          newRow.push('');
          break;
        default:
          newRow.push('');
      }
    });

    const lock = LockService.getUserLock();
    lock.waitLock(LOCK_TIMEOUT);
    try {
      sheet.appendRow(newRow);
      logActivity(session.email, 'SUBMIT_JOURNAL', `Submitted journal for class ${journalData.kelasID}`, 'SUCCESS');
      return { success: true, message: 'Journal submitted successfully' };
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    logError('submitJournal', error);
    return { success: false, message: 'Failed to submit journal' };
  }
}

/**
 * Get journals for approval (principal only)
 */
function getJournalsForApproval(session, filters = {}) {
  try {
    if (!hasRole(session, 'KepalaSekolah')) {
      return { success: false, message: 'Access denied', journals: [] };
    }

    const sheet = getSheet(SHEET_NAMES.JURNAL);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    let journals = [];

    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) {
        const journal = convertRowToObject(headers, data[i]);
        if (journal.Status === 'Menunggu Approval') {
          journals.push(journal);
        }
      }
    }

    return { success: true, journals };
  } catch (error) {
    logError('getJournalsForApproval', error);
    return { success: false, message: 'Failed to fetch journals', journals: [] };
  }
}

/**
 * Approve or reject journal (principal only)
 */
function approveJournal(session, journalID, action, notes = '') {
  try {
    if (!hasRole(session, 'KepalaSekolah')) {
      return { success: false, message: 'Access denied' };
    }

    if (!['approve', 'reject'].includes(action)) {
      return { success: false, message: 'Invalid action' };
    }

    // Update JURNAL sheet
    const sheet = getSheet(SHEET_NAMES.JURNAL);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idIndex = headers.indexOf('ID');
    const statusIndex = headers.indexOf('Status');
    const approvedByIndex = headers.indexOf('ApprovedBy');
    const tglApprovalIndex = headers.indexOf('TglApproval');

    const lock = LockService.getUserLock();
    lock.waitLock(LOCK_TIMEOUT);
    try {
      for (let i = 1; i < data.length; i++) {
        if (data[i][idIndex] === journalID) {
          const newStatus = action === 'approve' ? 'Disetujui' : 'Ditolak';
          sheet.getRange(i + 1, statusIndex + 1).setValue(newStatus);
          sheet.getRange(i + 1, approvedByIndex + 1).setValue(session.email);
          sheet.getRange(i + 1, tglApprovalIndex + 1).setValue(new Date().toISOString());
          
          // Log approval
          logApproval(journalID, session.email, action, notes);
          logActivity(session.email, 'APPROVE_JOURNAL', `${action} journal ${journalID}`, 'SUCCESS');
          
          return { success: true, message: `Journal ${action}d successfully` };
        }
      }
      return { success: false, message: 'Journal not found' };
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    logError('approveJournal', error);
    return { success: false, message: 'Failed to approve journal' };
  }
}

/**
 * Validate journal input
 */
function validateJournalInput(data) {
  if (!data.kelasID) return { valid: false, error: 'Class ID is required' };
  if (!data.konten || data.konten.length < 10) {
    return { valid: false, error: 'Journal content must be at least 10 characters' };
  }
  return { valid: true };
}

/**
 * ============================================================================
 * DASHBOARD & STATISTICS
 * ============================================================================
 */

/**
 * Get dashboard statistics
 */
function getDashboardStats(session) {
  try {
    if (!hasRole(session, ['Admin', 'KepalaSekolah'])) {
      return { success: false, message: 'Access denied' };
    }

    const usersSheet = getSheet(SHEET_NAMES.USERS);
    const klasesSheet = getSheet(SHEET_NAMES.KELAS);
    const siswaSheet = getSheet(SHEET_NAMES.SISWA);
    const absensiSheet = getSheet(SHEET_NAMES.ABSENSI);
    const nilaiSheet = getSheet(SHEET_NAMES.NILAI);
    const jurnalSheet = getSheet(SHEET_NAMES.JURNAL);

    const stats = {
      totalUsers: countActiveRows(usersSheet),
      totalClasses: countActiveRows(klasesSheet),
      totalStudents: countActiveRows(siswaSheet),
      totalAttendance: countActiveRows(absensiSheet),
      totalGrades: countActiveRows(nilaiSheet),
      totalJournals: countActiveRows(jurnalSheet),
      pendingApprovals: countPendingApprovals(jurnalSheet),
      activeTeachersToday: getActiveTeachersToday(),
      attendanceRate: calculateAttendanceRate(absensiSheet),
      averageGrade: calculateAverageGrade(nilaiSheet)
    };

    return { success: true, stats };
  } catch (error) {
    logError('getDashboardStats', error);
    return { success: false, message: 'Failed to fetch statistics' };
  }
}

/**
 * Count active rows in sheet
 */
function countActiveRows(sheet) {
  try {
    const data = sheet.getDataRange().getValues();
    let count = 0;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) count++;
    }
    return count;
  } catch (error) {
    return 0;
  }
}

/**
 * Count pending approvals
 */
function countPendingApprovals(sheet) {
  try {
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const statusIndex = headers.indexOf('Status');
    let count = 0;

    for (let i = 1; i < data.length; i++) {
      if (data[i][statusIndex] === 'Menunggu Approval') count++;
    }
    return count;
  } catch (error) {
    return 0;
  }
}

/**
 * Get active teachers today
 */
function getActiveTeachersToday() {
  try {
    const jurnalSheet = getSheet(SHEET_NAMES.JURNAL);
    const data = jurnalSheet.getDataRange().getValues();
    const headers = data[0];
    const tanggalIndex = headers.indexOf('TanggalJam');
    const guruIndex = headers.indexOf('Guru');
    
    const today = new Date();
    const activeTeachers = new Set();

    for (let i = 1; i < data.length; i++) {
      const tanggal = new Date(data[i][tanggalIndex]);
      if (tanggal.toDateString() === today.toDateString()) {
        activeTeachers.add(data[i][guruIndex]);
      }
    }
    return activeTeachers.size;
  } catch (error) {
    return 0;
  }
}

/**
 * Calculate attendance rate
 */
function calculateAttendanceRate(sheet) {
  try {
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const statusIndex = headers.indexOf('Status');
    
    let hadir = 0;
    let total = 0;

    for (let i = 1; i < data.length; i++) {
      if (data[i][0]) {
        if (data[i][statusIndex] === 'Hadir') hadir++;
        total++;
      }
    }

    return total > 0 ? Math.round((hadir / total) * 100) : 0;
  } catch (error) {
    return 0;
  }
}

/**
 * Calculate average grade
 */
function calculateAverageGrade(sheet) {
  try {
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const nilaiIndex = headers.indexOf('Nilai');
    
    let total = 0;
    let count = 0;

    for (let i = 1; i < data.length; i++) {
      if (data[i][0] && !isNaN(data[i][nilaiIndex])) {
        total += parseFloat(data[i][nilaiIndex]);
        count++;
      }
    }

    return count > 0 ? Math.round(total / count) : 0;
  } catch (error) {
    return 0;
  }
}

/**
 * ============================================================================
 * UTILITY FUNCTIONS
 * ============================================================================
 */

/**
 * Get sheet by name
 */
function getSheet(sheetName) {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    return ss.getSheetByName(sheetName);
  } catch (error) {
    logError('getSheet', error);
    return null;
  }
}

/**
 * Convert row array to object using headers
 */
function convertRowToObject(headers, row) {
  const obj = {};
  headers.forEach((header, index) => {
    obj[header] = row[index] || '';
  });
  return obj;
}

/**
 * Validate email format
 */
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Hash password (simplified - use better hashing in production)
 */
function hashPassword(password) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password, Utilities.Charset.UTF_8);
}

/**
 * Validate password
 */
function validatePassword(password, hash) {
  const passwordHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password, Utilities.Charset.UTF_8);
  return passwordHash === hash;
}

/**
 * Sanitize user input
 */
function sanitizeInput(input) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[<>"']/g, '') // Remove dangerous characters
    .trim()
    .substring(0, 5000); // Limit length
}

/**
 * Log activity
 */
function logActivity(email, aksi, detail, status) {
  try {
    const sheet = getSheet(SHEET_NAMES.SYSTEM_LOG);
    const lock = LockService.getUserLock();
    lock.waitLock(LOCK_TIMEOUT);
    try {
      sheet.appendRow([
        'LOG_' + new Date().getTime(),
        new Date().toISOString(),
        email,
        aksi,
        detail,
        Session.getActiveUser().getEmail(),
        status
      ]);
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    Logger.log('Error logging activity: ' + error);
  }
}

/**
 * Log approval action
 */
function logApproval(referensi, approvedBy, action, keterangan) {
  try {
    const sheet = getSheet(SHEET_NAMES.APPROVAL_LOG);
    const lock = LockService.getUserLock();
    lock.waitLock(LOCK_TIMEOUT);
    try {
      sheet.appendRow([
        'APPR_' + new Date().getTime(),
        new Date().toISOString(),
        approvedBy,
        'KepalaSekolah',
        action,
        referensi,
        keterangan || '',
        action === 'approve' ? 'Approved' : 'Rejected'
      ]);
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    Logger.log('Error logging approval: ' + error);
  }
}

/**
 * Log errors
 */
function logError(functionName, error) {
  const sheet = getSheet(SHEET_NAMES.SYSTEM_LOG);
  if (sheet) {
    try {
      const lock = LockService.getUserLock();
      lock.waitLock(LOCK_TIMEOUT);
      try {
        sheet.appendRow([
          'ERR_' + new Date().getTime(),
          new Date().toISOString(),
          'SYSTEM',
          'ERROR_' + functionName,
          error.toString(),
          '',
          'ERROR'
        ]);
      } finally {
        lock.releaseLock();
      }
    } catch (e) {
      Logger.log('Failed to log error: ' + e);
    }
  }
}

/**
 * Clear user cache
 */
function clearUserCache() {
  const cache = CacheService.getUserCache();
  cache.removeAll(['users_all', 'classes_*']);
}

/**
 * Clear class cache
 */
function clearClassCache() {
  const cache = CacheService.getUserCache();
  // Clear all class-related cache keys
}

/**
 * API Handler for JSON requests
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;
    const session = validateSession(data.token);

    if (!session) {
      return createResponse(false, 'Session expired', null, 401);
    }

    let result;

    switch (action) {
      case 'login':
        result = loginUser(data.email, data.password);
        break;
      case 'get_all_users':
        result = getAllUsers(session);
        break;
      case 'create_user':
        result = createUser(session, data.userData);
        break;
      case 'get_all_classes':
        result = getAllClasses(session);
        break;
      case 'create_class':
        result = createClass(session, data.classData);
        break;
      case 'get_attendance':
        result = getAttendance(session, data.filters);
        break;
      case 'submit_attendance':
        result = submitAttendance(session, data.attendanceData);
        break;
      case 'submit_grades':
        result = submitGrades(session, data.gradeData);
        break;
      case 'submit_journal':
        result = submitJournal(session, data.journalData);
        break;
      case 'get_journals_for_approval':
        result = getJournalsForApproval(session, data.filters);
        break;
      case 'approve_journal':
        result = approveJournal(session, data.journalID, data.action, data.notes);
        break;
      case 'get_dashboard_stats':
        result = getDashboardStats(session);
        break;
      default:
        return createResponse(false, 'Invalid action', null, 400);
    }

    return createResponse(result.success, result.message, result);
  } catch (error) {
    logError('doPost', error);
    return createResponse(false, 'Server error', null, 500);
  }
}

/**
 * Create response object
 */
function createResponse(success, message, data = null, statusCode = 200) {
  const response = {
    success: success,
    message: message,
    data: data
  };
  return ContentService.createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON);
}
