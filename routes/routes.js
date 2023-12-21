const express = require("express");
const router = express.Router();

const { isAuthenticatedUser, authorizeRoles } = require("../middleware/auth");
const {
  Checkgroup,
  checkLogin,
  loginUser,
  registerUser,
  getUsers,
  getUser,
  toggleUserStatus,
  updateUser,
  updateUserEmail,
  updateUserPassword,
  createGroup,
  getGroups,
  createApp,
  getAllApp,
  updateApp,
  createTask,
  createPlan,
  updatePlan,
  getAllPlan,
  getTask,
  updateTasknotes,
  assignTaskToPlan,
  getApplication,
  promoteTask,
  rejectTask,
  returnTask,
  getTasksByApp,
  getApp,
} = require("../controllers/controllers");

router.route("/login").post(loginUser);
router.route("/register").post(isAuthenticatedUser, authorizeRoles("admin"), registerUser);
router.route("/checkLogin").get(isAuthenticatedUser, async (req, res, next) => {
  const token = req.token;
  const result = await checkLogin(token);
  res.json(result);
});

//group
router.route("/createGroup").post(isAuthenticatedUser, authorizeRoles("admin"), createGroup);
router.route("/getGroups").get(isAuthenticatedUser, getGroups);
router.route("/checkGroup").post(isAuthenticatedUser, async (req, res, next) => {
  const username = req.user.username;
  const group = req.body.group;
  const result = await Checkgroup(username, group);
  res.json(result);
});

//user
router.route("/getUsers").get(isAuthenticatedUser, getUsers);
router.route("/getUser").get(isAuthenticatedUser, getUser);
router
  .route("/toggleUserStatus/:username")
  .put(isAuthenticatedUser, authorizeRoles("admin"), toggleUserStatus);
router.route("/updateUser/:username").put(isAuthenticatedUser, authorizeRoles("admin"), updateUser);
router.route("/updateUserEmail/").put(isAuthenticatedUser, updateUserEmail);
router.route("/updateUserPassword/").put(isAuthenticatedUser, updateUserPassword);

//app
router.route("/createApp").post(isAuthenticatedUser, authorizeRoles("PL"), createApp);
router.route("/getAllApp").get(isAuthenticatedUser, getAllApp);
router.route("/updateApp/:appname").put(isAuthenticatedUser, authorizeRoles("PL"), updateApp);
router.route("/getApplication/:App_Acronym").get(isAuthenticatedUser, getApplication);
router.route("/getApp").post(isAuthenticatedUser, getApp);

//plan
router.route("/createPlan").post(isAuthenticatedUser, authorizeRoles("PM"), createPlan);
router.route("/updatePlan").post(isAuthenticatedUser, authorizeRoles("PM"), updatePlan);
router.route("/getAllPlan").post(isAuthenticatedUser, getAllPlan);

//task
router.route("/createTask").post(isAuthenticatedUser, authorizeRoles("PL"), createTask);
router.route("/getTask/:Task_id").get(isAuthenticatedUser, getTask);
router.route("/promoteTask/:Task_id").put(isAuthenticatedUser, promoteTask); //Should be restricted to people with groups inside App_permit_Done
router.route("/rejectTask/:Task_id").put(isAuthenticatedUser, rejectTask); //Should be restricted to people with groups inside App_permit_Done
router.route("/returnTask/:Task_id").put(isAuthenticatedUser, returnTask); //Should be restricted to people with groups inside App_permit_Doing
router.route("/updateTasknotes/:taskId").post(isAuthenticatedUser, updateTasknotes);
router.route("/getTasksByApp/:App_Acronym").get(isAuthenticatedUser, getTasksByApp);

router
  .route("/assignTaskToPlan/:Task_id")
  .put(isAuthenticatedUser, authorizeRoles("PM", "PL"), assignTaskToPlan);

module.exports = router;
