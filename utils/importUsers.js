const ExcelJS = require("exceljs");
const nodemailer = require("nodemailer");
const userModel = require("../schemas/users");
const roleModel = require("../schemas/roles");

// Transporter dùng lại config từ senMailHandler
const transporter = nodemailer.createTransport({
    host: "sandbox.smtp.mailtrap.io",
    port: 2525,
    secure: false,
    auth: {
        user: "31cb73808366a9",
        pass: "9f5a647762145e",
    },
});

/**
 * Lấy giá trị text từ cell ExcelJS
 * Xử lý các dạng: string thuần, hyperlink object, rich text object
 */
function getCellText(cell) {
    const val = cell.value;
    if (val === null || val === undefined) return '';
    // Rich text: { richText: [{ text: '...' }, ...] }
    if (typeof val === 'object' && Array.isArray(val.richText)) {
        return val.richText.map(rt => rt.text || '').join('').trim();
    }
    // Hyperlink object: { text: '...', hyperlink: 'mailto:...' }
    if (typeof val === 'object' && val.text !== undefined) {
        return val.text.toString().trim();
    }
    // ExcelJS cũng có cell.text property riêng cho hyperlink
    if (cell.text && typeof cell.text === 'string') {
        return cell.text.trim();
    }
    return val.toString().trim();
}

/**
 * Sinh chuỗi password ngẫu nhiên 16 ký tự
 * gồm chữ hoa, chữ thường, số, ký tự đặc biệt
 */
function generatePassword(length = 16) {
    const chars =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
    let password = "";
    for (let i = 0; i < length; i++) {
        password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
}

/**
 * Gửi email thông báo mật khẩu cho user mới
 */
async function sendPasswordEmail(to, username, password) {
    await transporter.sendMail({
        from: "admin@hehehe.com",
        to: to,
        subject: "Tài khoản của bạn đã được tạo",
        text: `Xin chào ${username},\n\nTài khoản của bạn đã được tạo thành công.\nTên đăng nhập: ${username}\nMật khẩu: ${password}\n\nVui lòng đăng nhập và đổi mật khẩu ngay sau khi nhận được email này.\n\nTrân trọng,\nAdmin`,
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 500px; margin: auto; padding: 24px; border: 1px solid #e0e0e0; border-radius: 8px;">
                <h2 style="color: #4CAF50;">Tài khoản đã được tạo</h2>
                <p>Xin chào <strong>${username}</strong>,</p>
                <p>Tài khoản của bạn đã được tạo thành công với thông tin sau:</p>
                <table style="width:100%; border-collapse: collapse;">
                    <tr>
                        <td style="padding: 8px; font-weight: bold;">Tên đăng nhập:</td>
                        <td style="padding: 8px;">${username}</td>
                    </tr>
                    <tr style="background:#f9f9f9;">
                        <td style="padding: 8px; font-weight: bold;">Mật khẩu:</td>
                        <td style="padding: 8px; font-family: monospace; letter-spacing: 1px;">${password}</td>
                    </tr>
                </table>
                <p style="color: #e53935; margin-top: 16px;">⚠️ Vui lòng đăng nhập và <strong>đổi mật khẩu</strong> ngay sau khi nhận được email này.</p>
                <p>Trân trọng,<br/><strong>Admin</strong></p>
            </div>
        `,
    });
}

/**
 * Đọc file Excel và import users vào database
 * @param {string} filePath - Đường dẫn tuyệt đối tới file .xlsx
 */
async function importUsersFromExcel(filePath) {
    // Lấy role "user" từ database
    const userRole = await roleModel.findOne({ name: "user", isDeleted: false });
    if (!userRole) {
        throw new Error('Role "user" không tồn tại trong database. Vui lòng tạo role "user" trước.');
    }

    // Đọc file Excel
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.worksheets[0]; // Lấy sheet đầu tiên

    const results = {
        success: [],
        failed: [],
        skipped: [],
    };

    // Bỏ qua dòng đầu (header: username, email)
    const rows = [];
    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // skip header
        const username = getCellText(row.getCell(1));
        const email = getCellText(row.getCell(2));

        // DEBUG: In ra cell value dạng thô để xác định kiểu dữ liệu
        if (rowNumber === 2) {
            const raw1 = row.getCell(1).value;
            const raw2 = row.getCell(2).value;
            console.log('[DEBUG] Row 2 raw cell(1):', JSON.stringify(raw1), '| type:', typeof raw1);
            console.log('[DEBUG] Row 2 raw cell(2):', JSON.stringify(raw2), '| type:', typeof raw2);
            console.log('[DEBUG] Row 2 cell(2).text:', row.getCell(2).text);
            console.log('[DEBUG] Parsed -> username:', username, '| email:', email);
        }

        if (username && email) {
            rows.push({ username, email, rowNumber });
        }
    });

    console.log(`📋 Tổng số user cần import: ${rows.length}`);

    for (const { username, email, rowNumber } of rows) {
        try {
            // Kiểm tra user đã tồn tại chưa
            const existingUser = await userModel.findOne({
                $or: [{ username }, { email }],
            });

            if (existingUser) {
                console.log(`⚠️  Dòng ${rowNumber}: Bỏ qua - username "${username}" hoặc email "${email}" đã tồn tại`);
                results.skipped.push({ username, email, reason: "Đã tồn tại" });
                continue;
            }

            // Sinh password ngẫu nhiên 16 ký tự
            const rawPassword = generatePassword(16);

            // Tạo user mới (password sẽ được hash bởi pre-save hook)
            const newUser = new userModel({
                username,
                email,
                password: rawPassword,
                role: userRole._id,
                status: true,
            });

            await newUser.save();

            // Gửi email chứa password gốc cho user
            await sendPasswordEmail(email, username, rawPassword);

            console.log(`✅ Dòng ${rowNumber}: Tạo thành công user "${username}" - Email đã gửi tới ${email}`);
            results.success.push({ username, email });
        } catch (err) {
            console.error(`❌ Dòng ${rowNumber}: Lỗi khi tạo user "${username}" - ${err.message}`);
            results.failed.push({ username, email, reason: err.message });
        }
    }

    // Tổng kết
    console.log("\n========== KẾT QUẢ IMPORT ==========");
    console.log(`✅ Thành công : ${results.success.length}`);
    console.log(`⚠️  Bỏ qua    : ${results.skipped.length}`);
    console.log(`❌ Thất bại   : ${results.failed.length}`);
    console.log("=====================================\n");

    return results;
}

module.exports = { importUsersFromExcel };
