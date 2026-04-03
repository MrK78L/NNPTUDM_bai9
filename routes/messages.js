var express = require('express');
var router = express.Router();
let messageSchema = require('../schemas/messages');
let userSchema = require('../schemas/users');
let checkLogin = require('../utils/authHandler').checkLogin;
let path = require('path');
let { uploadImage, uploadExcel } = require('../utils/upload');

// Middleware for file upload (single file)
let uploadFile = require('multer')({
    storage: require('multer').diskStorage({
        destination: function (req, file, cb) {
            cb(null, "uploads/")
        },
        filename: function (req, file, cb) {
            let ext = path.extname(file.originalname)
            let name = Date.now() + "-" + Math.round(Math.random() * 2000_000_000) + ext;
            cb(null, name)
        }
    }),
    limits: 5 * 1024 * 1024
});

// GET /:userID - Lấy tất cả message giữa user hiện tại và userID
// (from: user hiện tại, to: userID) AND (from: userID, to: user hiện tại)
router.get('/:userID', checkLogin, async function (req, res, next) {
    try {
        let userID = req.params.userID;
        let currentUserId = req.user._id;

        // Kiểm tra userID có hợp lệ không
        let targetUser = await userSchema.findById(userID);
        if (!targetUser) {
            return res.status(404).send("User không tồn tại");
        }

        // Lấy tất cả message giữa hai user (bidirectional)
        let messages = await messageSchema
            .find({
                $or: [
                    { from: currentUserId, to: userID },
                    { from: userID, to: currentUserId }
                ]
            })
            .sort({ createdAt: 1 })
            .populate('from', 'username fullName avatarUrl')
            .populate('to', 'username fullName avatarUrl');

        res.send({
            status: 200,
            data: messages
        });
    } catch (error) {
        res.status(500).send("Có lỗi: " + error.message);
    }
});

// POST / - Gửi message mới
// Xử lý file upload và text message
router.post('/', checkLogin, uploadFile.single('file'), async function (req, res, next) {
    try {
        let { to, text } = req.body;
        let currentUserId = req.user._id;

        // Kiểm tra userID nhận tin có hợp lệ không
        if (!to) {
            return res.status(400).send("Vui lòng cung cấp userID người nhận");
        }

        let targetUser = await userSchema.findById(to);
        if (!targetUser) {
            return res.status(404).send("User nhận tin không tồn tại");
        }

        let messageContent = {};

        // Kiểm tra có file upload hay không
        if (req.file) {
            messageContent = {
                type: 'file',
                text: `uploads/${req.file.filename}`
            };
        } else if (text) {
            messageContent = {
                type: 'text',
                text: text
            };
        } else {
            return res.status(400).send("Vui lòng cung cấp nội dung tin nhắn (text) hoặc file");
        }

        // Tạo message mới
        let newMessage = new messageSchema({
            from: currentUserId,
            to: to,
            messageContent: messageContent
        });

        let savedMessage = await newMessage.save();
        
        // Populate user info
        await savedMessage.populate('from', 'username fullName avatarUrl');
        await savedMessage.populate('to', 'username fullName avatarUrl');

        res.status(201).send({
            status: 201,
            message: "Gửi tin nhắn thành công",
            data: savedMessage
        });
    } catch (error) {
        res.status(500).send("Có lỗi: " + error.message);
    }
});

// GET / - Lấy message cuối cùng của mỗi conversation
// (message cuối cùng từ mỗi user mà user hiện tại nhắn tin hoặc user khác nhắn cho user hiện tại)
router.get('/', checkLogin, async function (req, res, next) {
    try {
        let currentUserId = req.user._id;

        // Lấy tất cả message của user hiện tại
        let allMessages = await messageSchema
            .find({
                $or: [
                    { from: currentUserId },
                    { to: currentUserId }
                ]
            })
            .sort({ createdAt: -1 })
            .populate('from', 'username fullName avatarUrl')
            .populate('to', 'username fullName avatarUrl');

        // Tạo object để lưu message cuối cùng của mỗi conversation
        let conversationMap = {};

        allMessages.forEach(msg => {
            // Xác định user khác trong conversation
            let otherUserId = msg.from._id.equals(currentUserId) ? msg.to._id : msg.from._id;
            let otherUserIdStr = otherUserId.toString();

            // Nếu chưa có conversation này, thêm vào
            if (!conversationMap[otherUserIdStr]) {
                conversationMap[otherUserIdStr] = msg;
            }
        });

        // Convert object thành array
        let result = Object.values(conversationMap);

        res.send({
            status: 200,
            data: result
        });
    } catch (error) {
        res.status(500).send("Có lỗi: " + error.message);
    }
});

module.exports = router;
