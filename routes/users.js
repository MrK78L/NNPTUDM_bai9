var express = require("express");
var router = express.Router();
let { checkLogin, CheckPermission } = require('../utils/authHandler')
let { userCreateValidator
    , userUpdateValidator
    , handleResultValidator } = require('../utils/validatorHandler')
let userController = require("../controllers/users");
let { uploadExcel } = require('../utils/upload');
let { importUsersFromExcel } = require('../utils/importUsers');
let path = require('path');


// POST /api/v1/users/import — Upload file Excel và import users
router.post('/import', function (req, res, next) {
    uploadExcel.single('file')(req, res, async function (err) {
        // Bắt lỗi multer (Unexpected field, wrong format, ...)
        if (err) {
            return res.status(400).json({
                message: 'Lỗi upload: ' + err.message,
                hint: 'Hãy chắc chắn field name là "file" và file có định dạng .xlsx'
            });
        }
        if (!req.file) {
            return res.status(400).json({ message: 'Vui lòng upload file Excel (.xlsx)' });
        }
        try {
            const filePath = path.join(__dirname, '../', req.file.path);
            const results = await importUsersFromExcel(filePath);
            res.json({
                message: 'Import hoàn tất',
                success: results.success.length,
                skipped: results.skipped.length,
                failed: results.failed.length,
                details: results
            });
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    });
});

router.get("/", checkLogin, CheckPermission("ADMIN")
    , async function (req, res, next) {
        let users = await userController.GetAllUser();
        res.send(users);
    });

router.get("/:id", async function (req, res, next) {
    try {
        let result = await userModel
            .find({ _id: req.params.id, isDeleted: false })
        if (result.length > 0) {
            res.send(result);
        }
        else {
            res.status(404).send({ message: "id not found" });
        }
    } catch (error) {
        res.status(404).send({ message: "id not found" });
    }
});

router.post("/", userCreateValidator, handleResultValidator,
    async function (req, res, next) {
        try {
            let newItem = userController.CreateAnUser(
                req.body.username,
                req.body.password, req.body.email, req.body.fullName,
                req.body.avatarUrl, req.body.role, req.body.status, req.body.loginCount
            )
            await newItem.save();

            // populate cho đẹp
            let saved = await userModel
                .findById(newItem._id)
            res.send(saved);
        } catch (err) {
            res.status(400).send({ message: err.message });
        }
    });

router.put("/:id", userUpdateValidator, handleResultValidator, async function (req, res, next) {
    try {
        let id = req.params.id;
        //c1
        let updatedItem = await
            userModel.findByIdAndUpdate(id, req.body, { new: true });

        if (!updatedItem)
            return res.status(404).send({ message: "id not found" });
        //c2
        // let updatedItem = await userModel.findById(id);
        // if (updatedItem) {
        //     let keys = Object.keys(req.body);
        //     for (const key of keys) {
        //         getUser[key] = req.body[key]
        //     }
        // }
        // await updatedItem.save()
        let populated = await userModel
            .findById(updatedItem._id)
        res.send(populated);
    } catch (err) {
        res.status(400).send({ message: err.message });
    }
});

router.delete("/:id", async function (req, res, next) {
    try {
        let id = req.params.id;
        let updatedItem = await userModel.findByIdAndUpdate(
            id,
            { isDeleted: true },
            { new: true }
        );
        if (!updatedItem) {
            return res.status(404).send({ message: "id not found" });
        }
        res.send(updatedItem);
    } catch (err) {
        res.status(400).send({ message: err.message });
    }
});

module.exports = router;