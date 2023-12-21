const catchAsyncErrors = require("../middleware/catchAsyncErrors");
const ErrorResponse = require("../utils/errorHandler");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mysql = require("mysql2");
const nodemailer = require("nodemailer");

//Setting up database connection
const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});
if (connection) console.log(`MySQL Database connected with host: ${process.env.DB_HOST}`);

const validatePermit = catchAsyncErrors(async (App_Acronym, Task_state, user) => {
  //Check if application exists
  const [row, fields] = await connection
    .promise()
    .query("SELECT * FROM application WHERE App_Acronym = ?", [App_Acronym]);
  if (row.length === 0) {
    return next(new ErrorResponse("Application does not exist", 404));
  }

  //Check if user is allowed to perform the action
  const application = row[0];
  //Depending on the state, access the permit of the application
  let permit_state;
  switch (Task_state) {
    case "create":
      permit_state = application.App_permit_create;
      break;
    case "Open":
      permit_state = application.App_permit_Open;
      break;
    case "ToDo":
      permit_state = application.App_permit_toDoList;
      break;
    case "Doing":
      permit_state = application.App_permit_Doing;
      break;
    case "Done":
      permit_state = application.App_permit_Done;
      break;
    default:
      return next(new ErrorResponse("Invalid task state", 400));
    //check permit if it is null
  }
  if (permit_state === null || permit_state === undefined) {
    return false;
  }

  //Get user's groups
  const [row2, fields3] = await connection
    .promise()
    .query("SELECT * FROM user WHERE username = ?", [user]);
  if (row2.length === 0) {
    return next(new ErrorResponse("User does not exist", 404));
  }

  //Get the user's groups
  const user_groups = row2[0].group_list.split(",");
  //Check if any of the user's groups is included in the permit array, then the user is authorized. The group has to match exactly
  //for each group in the group array, check match exact as group parameter
  const authorised = user_groups.includes(permit_state);
  //Since permit can only have one group, we just need to check if the user's groups contains the permit
  if (!authorised) {
    return false;
  }
  return true;
});

// Get a specific app => /controller/getApp
exports.getApp = catchAsyncErrors(async (req, res, next) => {
  const [rows, fields] = await connection
    .promise()
    .query("SELECT * FROM application WHERE App_Acronym =?", [req.body.acronym]);
  res.status(200).json({
    success: true,
    data: rows,
  });
});

//getTasksByApp => /controller/getTasksByApp/:App_Acronym
exports.getTasksByApp = catchAsyncErrors(async (req, res, next) => {
  //Check if user is authorized to get tasks
  const App_Acronym = req.params.App_Acronym;
  const [row, fields] = await connection
    .promise()
    .query("SELECT * FROM application WHERE App_Acronym = ?", [App_Acronym]);
  if (row.length === 0) {
    return next(new ErrorResponse("Application does not exist", 404));
  }
  const application = row[0];
  //I want to pull out all the tasks that belong to this application as well as the Plan_color that belongs to each task
  //SELECT task.*, plan.Plan_color FROM task LEFT JOIN plan ON task.Task_plan = plan.Plan_MVP_name WHERE Task_app_Acronym = "test";
  const [row2, fields2] = await connection
    .promise()
    .query(
      "SELECT task.*, plan.Plan_color FROM task LEFT JOIN plan ON task.Task_plan = plan.Plan_MVP_name AND task.Task_app_Acronym = plan.Plan_app_Acronym WHERE Task_app_Acronym = ?",
      [App_Acronym]
    );

  // const [row2, fields2] = await connection.promise().query("SELECT * FROM task WHERE Task_app_acronym = ?", [App_Acronym])
  // if (row2.length === 0) {
  //   return next(new ErrorResponse("No tasks found", 404))
  // }
  res.status(200).json({
    success: true,
    data: row2,
  });
});
//returnTask => /controller/returnTask/:Task_id
exports.returnTask = catchAsyncErrors(async (req, res, next) => {
  //Check if user is authorized to return task
  const Task_id = req.params.Task_id;
  const [row, fields] = await connection
    .promise()
    .query("SELECT * FROM task WHERE Task_id = ?", [Task_id]);
  if (row.length === 0) {
    return next(new ErrorResponse("Task does not exist", 404));
  }

  //Check if user is allowed to perform the action
  const validate = await validatePermit(
    row[0].Task_app_Acronym,
    row[0].Task_state,
    req.user.username
  );
  if (!validate) {
    return next(new ErrorResponse("You are not authorised", 403));
  }

  //Get the current state of the task
  const Task_state = row[0].Task_state;
  //If the current state is not Doing, we cannot return the task
  if (Task_state !== "Doing") {
    return next(new ErrorResponse("You cannot return a task that is not Doing", 400));
  }
  //The state will always be ToDo when returning a task
  const nextState = "ToDo";

  //Get the Task_owner from the req.user.username
  const Task_owner = req.user.username;
  const date = new Date(Date.now());
  const formattedDate = date.toLocaleString();
  let Added_Task_notes;
  if (
    req.body.Task_notes === undefined ||
    req.body.Task_notes === null ||
    req.body.Task_notes === ""
  ) {
    //append {Task_owner} moved {Task_name} from {Task_state} to {nextState} to the end of Task_note
    Added_Task_notes =
      Task_owner +
      " moved " +
      row[0].Task_name +
      " from " +
      Task_state +
      " to " +
      nextState +
      " on " +
      formattedDate;
  } else {
    //Get the Task_notes from the req.body.Task_notes and append {Task_owner} moved {Task_name} from {Task_state} to {nextState} to the end of Task_note
    Added_Task_notes =
      Task_owner +
      " moved " +
      row[0].Task_name +
      " from " +
      Task_state +
      " to " +
      nextState +
      " on " +
      formattedDate +
      "\n" +
      req.body.Task_notes;
  }

  //Append Task_notes to the preexisting Task_notes
  const Task_notes = Added_Task_notes + "\n\n" + row[0].Task_notes;

  //Update the task
  const result = await connection
    .promise()
    .execute("UPDATE task SET Task_notes = ?, Task_state = ?, Task_owner = ? WHERE Task_id = ?", [
      Task_notes,
      nextState,
      Task_owner,
      Task_id,
    ]);
  if (result[0].affectedRows === 0) {
    return next(new ErrorResponse("Failed to return task", 500));
  }

  res.status(200).json({
    success: true,
    message: "Task returned successfully",
  });
});

// rejectTask => /controller/rejectTask/:Task_id
exports.rejectTask = catchAsyncErrors(async (req, res, next) => {
  const Task_id = req.params.Task_id;
  const [row, fields] = await connection
    .promise()
    .query("SELECT * FROM task WHERE Task_id = ?", [Task_id]);
  if (row.length === 0) {
    return next(new ErrorResponse("Task does not exist", 404));
  }

  //Check if user is allowed to perform the action
  const validate = await validatePermit(
    row[0].Task_app_Acronym,
    row[0].Task_state,
    req.user.username
  );
  if (!validate) {
    return next(new ErrorResponse("You are not authorised", 403));
  }

  //Get the current state of the task
  const Task_state = row[0].Task_state;
  //If the current state is not Done, we cannot reject the task
  if (Task_state !== "Done") {
    return next(new ErrorResponse("You cannot reject a task that is not Done", 400));
  }
  //The state will always be Doing when rejecting a task
  const nextState = "Doing";

  //Get the Task_owner from the req.user.username
  const Task_owner = req.user.username;
  const date = new Date(Date.now());
  const formattedDate = date.toLocaleString();
  let Added_Task_notes;
  if (
    req.body.Task_notes === undefined ||
    req.body.Task_notes === null ||
    req.body.Task_notes === ""
  ) {
    //append {Task_owner} moved {Task_name} from {Task_state} to {nextState} to the end of Task_note
    Added_Task_notes =
      Task_owner +
      " moved " +
      row[0].Task_name +
      " from " +
      Task_state +
      " to " +
      nextState +
      " on " +
      formattedDate;
  } else {
    //Get the Task_notes from the req.body.Task_notes and append {Task_owner} moved {Task_name} from {Task_state} to {nextState} to the end of Task_note
    Added_Task_notes =
      Task_owner +
      " moved " +
      row[0].Task_name +
      " from " +
      Task_state +
      " to " +
      nextState +
      " on " +
      formattedDate +
      "\n" +
      req.body.Task_notes;
  }

  //Append Task_notes to the preexisting Task_notes
  const Task_notes = Added_Task_notes + "\n\n" + row[0].Task_notes;

  //Task_plan can be updated if it is provided
  let Task_plan;
  if (req.body.Task_plan === undefined || null) {
    Task_plan = row[0].Task_plan;
  } else {
    Task_plan = req.body.Task_plan;
  }

  //Update the task
  const result = await connection
    .promise()
    .execute(
      "UPDATE task SET Task_notes = ?, Task_state = ?, Task_owner = ?, Task_plan = ? WHERE Task_id = ?",
      [Task_notes, nextState, Task_owner, Task_plan, Task_id]
    );
  if (result[0].affectedRows === 0) {
    return next(new ErrorResponse("Failed to reject task", 500));
  }

  res.status(200).json({
    success: true,
    message: "Task rejected successfully",
  });
});

//promoteTask => /controller/promoteTask/:Task_id
exports.promoteTask = catchAsyncErrors(async (req, res, next) => {
  const Task_id = req.params.Task_id;
  const [row, fields] = await connection
    .promise()
    .query("SELECT * FROM task WHERE Task_id = ?", [Task_id]);
  if (row.length === 0) {
    return next(new ErrorResponse("Task does not exist", 404));
  }

  //Check if user is allowed to perform the action
  const validate = await validatePermit(
    row[0].Task_app_Acronym,
    row[0].Task_state,
    req.user.username
  );
  if (!validate) {
    return next(new ErrorResponse("You are not authorised", 403));
  }

  //Get the current state of the task
  const Task_state = row[0].Task_state;
  //If the current state is Close, we cannot promote the task
  if (Task_state === "Close") {
    return next(new ErrorResponse("You cannot promote a task that is Closed", 400));
  }
  //Depending on the current state, we will update the state to the next state
  let nextState;
  switch (Task_state) {
    case "Open":
      nextState = "ToDo";
      break;
    case "ToDo":
      nextState = "Doing";
      break;
    case "Doing":
      nextState = "Done";
      break;
    case "Done":
      nextState = "Close";
      break;
    default:
      nextState = "Close";
  }

  //Get the Task_owner from the req.user.username
  const Task_owner = req.user.username;

  const date = new Date(Date.now());
  const formattedDate = date.toLocaleString();

  let Added_Task_notes;
  if (
    req.body.Task_notes === undefined ||
    req.body.Task_notes === null ||
    req.body.Task_notes === ""
  ) {
    //append {Task_owner} moved {Task_name} from {Task_state} to {nextState} to the end of Task_note
    Added_Task_notes =
      Task_owner +
      " moved " +
      row[0].Task_name +
      " from " +
      Task_state +
      " to " +
      nextState +
      " on " +
      formattedDate;
  } else {
    //Get the Task_notes from the req.body.Task_notes and append {Task_owner} moved {Task_name} from {Task_state} to {nextState} to the end of Task_note
    Added_Task_notes =
      Task_owner +
      " moved " +
      row[0].Task_name +
      " from " +
      Task_state +
      " to " +
      nextState +
      " on " +
      formattedDate +
      "\n" +
      req.body.Task_notes;
  }

  //Append Task_notes to the preexisting Task_notes, I want it to have two new lines between the old notes and the new notes
  const Task_notes = Added_Task_notes + "\n\n" + row[0].Task_notes;
  //Update the task
  const result = await connection
    .promise()
    .execute("UPDATE task SET Task_notes = ?, Task_state = ?, Task_owner = ? WHERE Task_id = ?", [
      Task_notes,
      nextState,
      Task_owner,
      Task_id,
    ]);
  if (result[0].affectedRows === 0) {
    return next(new ErrorResponse("Failed to promote task", 500));
  }

  res.status(200).json({
    success: true,
    message: "Task promoted successfully",
  });

  if (Task_state === "Doing" && nextState === "Done") {
    sendEmailToProjectLead(row[0].Task_name, Task_owner, row[0].Task_app_Acronym);
  }
});

async function sendEmailToProjectLead(taskName, taskOwner, Task_app_acronym) {
  //We need to pull the App_permit_Done group
  const [row, fields] = await connection
    .promise()
    .query("SELECT * FROM application WHERE App_Acronym = ?", [Task_app_acronym]);

  const group = row[0].App_permit_Done;

  //We need to pull the emails of all users
  const [row2, fields2] = await connection.promise().query("SELECT * FROM user");
  const users = row2;

  //We need to pull the emails of all users that are in the group
  let emails = [];
  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    const user_groups = user.group_list.split(",");
    if (user_groups.includes(group)) {
      //check if email is null or undefined
      if (user.email !== null && user.email !== undefined) {
        emails.push(user.email);
      }
    }
  }
  console.log(emails);
  // Set up transporter
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  // Define mail options
  const mailOptions = {
    from: `${process.env.SMTP_FROM_NAME} <${process.env.SMTP_FROM_EMAIL}>`,
    to: emails, // Replace with the actual project lead's email
    subject: `Task Promotion Notification`,
    text: `The task "${taskName}" has been promoted to "Done" by ${taskOwner}.`,
  };
  console.log(mailOptions);

  // Send the email
  try {
    //transporter.sendMail(mailOptions);
    console.log("Email sent successfully.");
  } catch (error) {
    console.error("Failed to send email:", error);
  }
}

//getApplication => /controller/getApplication/:App_Acronym
exports.getApplication = catchAsyncErrors(async (req, res, next) => {
  //Check if user is authorized to get application
  const App_Acronym = req.params.App_Acronym;
  const [row, fields] = await connection
    .promise()
    .query("SELECT * FROM application WHERE App_Acronym = ?", [App_Acronym]);
  if (row.length === 0) {
    return next(new ErrorResponse("Application does not exist", 404));
  }
  res.status(200).json({
    success: true,
    data: row[0],
  });
});

// Update tasknotes by taskid => /controller/updateTasknotes/: taskid
exports.updateTasknotes = catchAsyncErrors(async (req, res, next) => {
  const [row, fields] = await connection
    .promise()
    .query("SELECT * FROM task WHERE Task_id = ?", [req.params.taskId]);
  const token = req.token;
  const date = new Date(Date.now());
  const formattedDate = date.toLocaleString();

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return false;
  }

  //We should append the notes to the existing notes, so we need to get the existing notes first
  const existing_notes = row[0].Task_notes;
  //Append the existing notes with the new notes
  req.body.Task_notes =
    decoded.username + " " + formattedDate + "\n" + req.body.Task_notes + "\n\n" + existing_notes;

  //Update notes
  const result = await connection
    .promise()
    .execute("UPDATE task SET Task_notes = ? WHERE Task_id = ?", [
      req.body.Task_notes,
      req.params.taskId,
    ]);
  if (result[0].affectedRows === 0) {
    return next(new ErrorResponse("Failed to update notes", 500));
  }
  updateOwner = await connection
    .promise()
    .execute("UPDATE task SET Task_owner = ? WHERE Task_id = ?", [
      decoded.username,
      req.params.taskId,
    ]);
  res.status(200).json({
    success: true,
    message: "Task notes updated successfully",
  });
});
//assignTaskToPlan => /controller/assignTaskToPlan/:task_id
exports.assignTaskToPlan = catchAsyncErrors(async (req, res, next) => {
  //Check if user is authorized to assign plan to task
  const { Plan_app_Acronym, Plan_MVP_name } = req.body;
  const Task_id = req.params.Task_id;
  const [row, fields] = await connection
    .promise()
    .query("SELECT * FROM plan WHERE Plan_app_Acronym = ? AND Plan_MVP_name = ?", [
      Plan_app_Acronym,
      Plan_MVP_name,
    ]);
  if (row.length === 0) {
    return next(new ErrorResponse("Plan does not exist", 404));
  }

  //Check if task exists
  const [row2, fields2] = await connection
    .promise()
    .query("SELECT * FROM task WHERE Task_id = ?", [Task_id]);
  if (row2.length === 0) {
    return next(new ErrorResponse("Task does not exist", 404));
  }

  //Check if application exists
  const [row3, fields3] = await connection
    .promise()
    .query("SELECT * FROM application WHERE App_Acronym = ?", [Plan_app_Acronym]);
  if (row3.length === 0) {
    return next(new ErrorResponse("Application does not exist", 404));
  }

  //Check if any of the required parameters are not provided
  if (!Plan_app_Acronym || !Plan_MVP_name) {
    return next(new ErrorResponse("Invalid input", 400));
  }

  //Get the Task_owner from the req.user.username
  const Task_owner = req.user.username;
  let Added_Task_notes;
  if (req.body.Task_notes === undefined || null) {
    //append {Task_owner} assigned {Task_name} to {Plan_MVP_name} to the end of Task_note
    Added_Task_notes =
      Task_owner + " assigned " + row2[0].Task_name + " to " + Plan_MVP_name + "\n";
  } else {
    //Get the Task_notes from the req.body.Task_notes and append {Task_owner} assigned {Task_name} to {Plan_MVP_name} to the end of Task_note
    Added_Task_notes =
      Task_owner +
      " assigned " +
      row2[0].Task_name +
      " to " +
      Plan_MVP_name +
      "\n" +
      req.body.Task_notes +
      "\n";
  }

  //Append Task_notes to the preexisting Task_notes
  const Task_notes = Added_Task_notes + "\n" + row2[0].Task_notes;

  //Update the task including the task_owner
  const result = await connection
    .promise()
    .execute("UPDATE task SET Task_notes = ?, Task_plan = ?, Task_owner = ? WHERE Task_id = ?", [
      Task_notes,
      Plan_MVP_name,
      Task_owner,
      Task_id,
    ]);
  if (result[0].affectedRows === 0) {
    return next(new ErrorResponse("Failed to assign plan to task", 500));
  }

  res.status(200).json({
    success: true,
    message: "Plan assigned to task successfully",
  });
});

// getTask => /controller/getTask/:Task_id
exports.getTask = catchAsyncErrors(async (req, res, next) => {
  //Check if user is authorized to get task
  const Task_id = req.params.Task_id;
  const [row, fields] = await connection
    .promise()
    .query("SELECT * FROM task WHERE Task_id = ?", [Task_id]);
  if (row.length === 0) {
    return next(new ErrorResponse("Task does not exist", 404));
  }
  res.status(200).json({
    success: true,
    data: row[0],
  });
});

//Create Plan => /controller/createPlan
exports.createPlan = catchAsyncErrors(async (req, res, next) => {
  const { plan, startDate, endDate, colors, acronym } = req.body;

  if (req.body.plan === "" || null) {
    return next(new ErrorResponse("Please enter input for the Plan name", 400));
  }

  let result;
  try {
    result = await connection
      .promise()
      .execute(
        "INSERT INTO plan (Plan_MVP_name, Plan_startDate, Plan_endDate, Plan_app_Acronym, Plan_color) VALUES (?,?,?,?,?)",
        [plan, startDate, endDate, acronym, colors]
      );
  } catch (error) {
    //check duplicate entry
    if (error.code === "ER_DUP_ENTRY") {
      return next(new ErrorResponse("Plan name already exists", 400));
    }
  }
  if (result[0].affectedRows === 0) {
    return next(new ErrorResponse("Failed to create plan", 500));
  }

  res.status(200).json({
    success: true,
    message: "Plan created successfully",
  });
});

//Create Task => /controller/createTask
exports.createTask = catchAsyncErrors(async (req, res, next) => {
  const { name, description, acronym } = req.body;
  const token = req.token;
  if (req.body.name === "" || null) {
    return next(new ErrorResponse("Please enter input for the Task name", 400));
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return false;
  }
  const date = new Date(Date.now());
  const formattedDate = date.toLocaleString();
  let notes = decoded.username + " Open " + formattedDate;
  let rnum = await connection
    .promise()
    .execute("SELECT App_Rnumber FROM application where App_Acronym = ?", [acronym]);
  let rnumber = rnum[0][0].App_Rnumber + 1;
  let Task_id = acronym + rnumber;
  let result;
  try {
    result = await connection
      .promise()
      .execute(
        "INSERT INTO task (Task_name, Task_description, Task_notes, Task_id, Task_app_Acronym, Task_state, Task_creator, Task_owner) VALUES (?,?,?,?,?,?,?,?)",
        [name, description, notes, Task_id, acronym, "Open", decoded.username, decoded.username]
      );
    updateRnum = await connection
      .promise()
      .execute("UPDATE application SET App_Rnumber = ? where App_Acronym = ?", [rnumber, acronym]);
  } catch (error) {
    //check duplicate entry
    if (error.code === "ER_DUP_ENTRY") {
      return next(new ErrorResponse("Task name already exists", 400));
    } else {
      return next(new ErrorResponse("Task failed", 400));
    }
  }
  if (result[0].affectedRows === 0) {
    return next(new ErrorResponse("Failed to create Task", 500));
  }

  res.status(200).json({
    success: true,
    message: "Task created successfully",
  });
});

//Update App details => /controller/updateApp/:appname
exports.updateApp = catchAsyncErrors(async (req, res, next) => {
  const [row, fields] = await connection
    .promise()
    .query("SELECT * FROM application WHERE App_Acronym = ?", [req.params.appname]);
  if (row.length === 0) {
    return next(new ErrorResponse("App not found", 404));
  }
  const app = row[0];
  //the fields are optional to update, so we need to build the query dynamically
  let query = "UPDATE application SET ";
  let values = [];
  //Updatable fields are start/end dates, description, App permissions.
  if (req.body.startDate) {
    query += "App_startDate = ?, ";
    values.push(req.body.startDate);
  } else if (req.body.startDate === undefined) {
    query += "App_startDate = ?, ";
    values.push(null);
  }
  if (req.body.endDate) {
    query += "App_endDate = ?, ";
    values.push(req.body.endDate);
  } else if (req.body.endDate === undefined) {
    query += "App_endDate = ?, ";
    values.push(null);
  }
  if (req.body.description) {
    query += "App_Description = ?, ";
    values.push(req.body.description);
  } else if (req.body.description === undefined) {
    query += "App_Description = ?, ";
    values.push("");
  }
  if (req.body.permCreate) {
    query += "App_permit_create = ?, ";
    values.push(req.body.permCreate);
  }
  if (req.body.permOpen) {
    query += "App_permit_Open = ?, ";
    values.push(req.body.permOpen);
  }
  if (req.body.permToDo) {
    query += "App_permit_toDoList = ?, ";
    values.push(req.body.permToDo);
  }
  if (req.body.permDoing) {
    query += "App_permit_Doing = ?, ";
    values.push(req.body.permDoing);
  }
  if (req.body.permDone) {
    query += "App_permit_Done = ?, ";
    values.push(req.body.permDone);
  }
  //group can be empty, if it is empty we should update the permission to empty
  if (req.body.permCreate === "") {
    query += "App_permit_create = ?, ";
    values.push("");
  }
  if (req.body.permOpen === "") {
    query += "App_permit_Open = ?, ";
    values.push("");
  }
  if (req.body.permToDo === "") {
    query += "App_permit_toDoList = ?, ";
    values.push("");
  }
  if (req.body.permDoing === "") {
    query += "App_permit_Doing = ?, ";
    values.push("");
  }
  if (req.body.permDone === "") {
    query += "App_permit_Done = ?, ";
    values.push("");
  }
  //remove the last comma and space
  query = query.slice(0, -2);
  //add the where clause
  query += " WHERE App_Acronym = ?";
  values.push(req.params.appname);
  const result = await connection.promise().execute(query, values);
  if (result[0].affectedRows === 0) {
    return next(new ErrorResponse("Failed to update app", 500));
  }

  res.status(200).json({
    success: true,
    message: "App updated successfully",
  });
});

// updatePlan => /controller/updatePlan
exports.updatePlan = catchAsyncErrors(async (req, res, next) => {
  const { planAcronym, startDate, endDate, planName } = req.body;
  const [rows, fields] = await connection
    .promise()
    .query(
      "UPDATE plan SET Plan_startDate=?,Plan_endDate=? WHERE Plan_MVP_name=? AND Plan_app_Acronym=?",
      [startDate, endDate, planName, planAcronym]
    );
  res.status(200).json({
    success: true,
    message: "Plan created successfully",
  });
});
// Get all plan by plan name => /controller/getAllPlan
exports.getAllPlan = catchAsyncErrors(async (req, res, next) => {
  const { Plan_app_Acronym } = req.body;
  const [rows, fields] = await connection
    .promise()
    .query("SELECT * FROM plan where Plan_app_Acronym=?", [Plan_app_Acronym]);
  res.status(200).json({
    success: true,
    data: rows,
  });
});
// Get all app => /controller/getAllApp
exports.getAllApp = catchAsyncErrors(async (req, res, next) => {
  const [rows, fields] = await connection.promise().query("SELECT * FROM application");
  res.status(200).json({
    success: true,
    data: rows,
  });
});

// Create App => /createApp
exports.createApp = catchAsyncErrors(async (req, res, next) => {
  const {
    application,
    startDate,
    endDate,
    description,
    permCreate,
    permOpen,
    permToDo,
    permDoing,
    permDone,
    rnum,
  } = req.body;

  if (
    req.body.application === "" ||
    req.body.application === null ||
    req.body.description === "" ||
    req.body.description === null ||
    req.body.rnum === "" ||
    req.body.rum === null
  ) {
    return next(new ErrorResponse("Please enter App Acronym and Description and Rnum", 400));
  }

  const rnumRegex = /^\d+$/;
  if (!rnumRegex.test(rnum)) {
    return next(new ErrorResponse("Rnum can only be integer and not negative", 400));
  }

  let result;
  try {
    result = await connection
      .promise()
      .execute(
        "INSERT INTO application (App_Acronym,App_Description,App_Rnumber,App_startDate,App_endDate,App_permit_Open," +
          "App_permit_toDoList,App_permit_Doing,App_permit_Done,App_permit_create) VALUES (?,?,?,?,?,?,?,?,?,?)",
        [
          application,
          description,
          rnum,
          startDate,
          endDate,
          permOpen,
          permToDo,
          permDoing,
          permDone,
          permCreate,
        ]
      );
  } catch (err) {
    //check duplicate entry
    if (err.code === "ER_DUP_ENTRY") {
      return next(new ErrorResponse("App Acronym already exists", 400));
    }
  }
  if (result[0].affectedRows === 0) {
    return next(new ErrorResponse("Failed to create App", 500));
  }

  res.status(200).json({
    success: true,
    message: "App created successfully",
  });
});
// checkGroup(username, group) to check if a user is in a group
exports.Checkgroup = async function (userid, groupname) {
  //get user from database
  const [row, fields] = await connection
    .promise()
    .query("SELECT * FROM user WHERE username = ?", [userid]);
  if (row.length === 0) {
    return false;
  }
  const user = row[0];
  //User can have multiple groups delimited by ,{group},{group}. We need to split them into an array
  user.group_list = user.group_list.split(",");
  //if any of the user's groups is included in the roles array, then the user is authorized. The group has to match exactly
  //for each group in the group array, check match exact as group parameter
  authorised = user.group_list.includes(groupname);
  if (!authorised) {
    return false;
  }
  return true;
};

exports.check = catchAsyncErrors(async function (token) {
  if (token === "null" || !token) {
    return false;
  }
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return false;
  }

  const [row, fields] = await connection
    .promise()
    .query("SELECT * FROM user WHERE username = ?", [decoded.username]);
  const user = row[0];
  if (user === undefined) {
    return false;
  }

  if (user.is_disabled === 1) {
    return false;
  }
  return true;
});

exports.checkLogin = catchAsyncErrors(async function (token) {
  if (token === "null" || !token) {
    return false;
  }
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return false;
  }

  const [row, fields] = await connection
    .promise()
    .query("SELECT * FROM user WHERE username = ?", [decoded.username]);
  const user = row[0];
  if (user === undefined) {
    return false;
  }

  if (user.is_disabled === 1) {
    return false;
  }
  return true;
});

// Login a user => /login
exports.loginUser = catchAsyncErrors(async (req, res, next) => {
  //get username and password from request body
  const { username, password } = req.body;

  //check if username and password is provided
  if (!username || !password) {
    return next(new ErrorResponse("Please provide a username and password", 400));
  }

  //find user in database
  const [row, fields] = await connection
    .promise()
    .query("SELECT * FROM user WHERE username = ?", [username]);
  if (row.length === 0) {
    return next(new ErrorResponse("Invalid username or password", 401));
  }
  //get user from row
  const user = row[0];

  //Use bcrypt to compare password
  const isPasswordMatched = await bcrypt.compare(password, user.password);
  if (!isPasswordMatched) {
    return next(new ErrorResponse("Invalid username or password", 401));
  }

  //Check if user is disabled
  if (user.is_disabled === 1) {
    return next(new ErrorResponse("Invalid username or password", 401));
  }

  //Send token
  sendToken(user, 200, res);
});

// Create a user => /register
exports.registerUser = catchAsyncErrors(async (req, res, next) => {
  const { username, password, email, group_list } = req.body;

  if (req.body.username === "" || null) {
    return next(new ErrorResponse("Please enter input in the username", 400));
  }

  //We need to check for password constraint, minimum character is 8 and maximum character is 10. It should include alphanumeric, number and special character. We do not care baout uppercase and lowercase.
  const passwordRegex = /^(?=.*[a-z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,10}$/;
  if (!passwordRegex.test(password)) {
    return next(
      new ErrorResponse(
        "Password must be 8-10 characters long, contain at least one number, one letter and one special character",
        400
      )
    );
  }

  //Bcrypt password with salt 10
  const hashedPassword = await bcrypt.hash(password, 10);
  let result;
  try {
    result = await connection
      .promise()
      .execute(
        "INSERT INTO user (username, password, email, `group_list`, is_disabled) VALUES (?,?,?,?,?)",
        [username, hashedPassword, email, group_list, 0]
      );
  } catch (err) {
    //check duplicate entry
    if (err.code === "ER_DUP_ENTRY") {
      return next(new ErrorResponse("Username already exists", 400));
    }
  }
  if (result[0].affectedRows === 0) {
    return next(new ErrorResponse("Failed to create user", 500));
  }

  res.status(200).json({
    success: true,
    message: "User created successfully",
  });
});

// Create a group => /controller/createGroup
exports.createGroup = catchAsyncErrors(async (req, res, next) => {
  const { group_name } = req.body;

  //split group_name by comma
  const group_name_list = group_name.split(",");

  //Check if group already exists
  const [row, fields] = await connection
    .promise()
    .query("SELECT * FROM usergroups WHERE group_name IN (?)", [group_name_list]);
  if (row.length !== 0) {
    return next(new ErrorResponse("Group already exists", 400));
  }

  //Regex to check if group name is alphanumeric and no space
  const groupRegex = /^[a-zA-Z0-9]+$/;
  for (let i = 0; i < group_name_list.length; i++) {
    if (!groupRegex.test(group_name_list[i])) {
      return next(new ErrorResponse("Group name must be alphanumeric and no space", 400));
    }
  }

  //Insert group into database one by one
  for (let i = 0; i < group_name_list.length; i++) {
    const result = await connection
      .promise()
      .execute("INSERT INTO usergroups (group_name) VALUES (?)", [group_name_list[i]]);

    if (result[0].affectedRows === 0) {
      return next(new ErrorResponse("Failed to create group", 500));
    }
  }

  res.status(200).json({
    success: true,
    message: "Group(s) created successfully",
  });
});

// Get all users => /controller/getUsers
exports.getUsers = catchAsyncErrors(async (req, res, next) => {
  const [rows, fields] = await connection
    .promise()
    .query("SELECT username,email,group_list,is_disabled FROM user where not username='admin'");
  res.status(200).json({
    success: true,
    data: rows,
  });
});

// Get a user => /controller/getUser
exports.getUser = catchAsyncErrors(async (req, res, next) => {
  const username = req.user.username;
  const [row, fields] = await connection
    .promise()
    .query("SELECT username,email,group_list FROM user WHERE username = ?", [username]);
  if (row.length === 0) {
    return next(new ErrorResponse("User not found", 404));
  }
  res.status(200).json({
    success: true,
    data: row[0],
  });
});

// Toggle user status => /controller/toggleUserStatus/:username
exports.toggleUserStatus = catchAsyncErrors(async (req, res, next) => {
  const [row, fields] = await connection
    .promise()
    .query("SELECT * FROM user WHERE username = ?", [req.params.username]);
  if (row.length === 0) {
    return next(new ErrorResponse("User not found", 404));
  }

  const user = row[0];
  //new status should be flip of current status
  const newStatus = user.is_disabled === 1 ? 0 : 1;
  const result = await connection
    .promise()
    .execute("UPDATE user SET is_disabled = ? WHERE username = ?", [
      newStatus,
      req.params.username,
    ]);
  if (result[0].affectedRows === 0) {
    return next(new ErrorResponse("Failed to update user", 500));
  }

  res.status(200).json({
    success: true,
    message: "User updated successfully",
  });
});

// Update a user (admin) => /controller/updateUser/:username
exports.updateUser = catchAsyncErrors(async (req, res, next) => {
  const [row, fields] = await connection
    .promise()
    .query("SELECT * FROM user WHERE username = ?", [req.params.username]);
  if (row.length === 0) {
    return next(new ErrorResponse("User not found", 404));
  }
  const user = row[0];
  //We need to check for password constraint, minimum character is 8 and maximum character is 10. It should include alphanumeric, number and special character. We do not care baout uppercase and lowercase.
  const passwordRegex = /^(?=.*[a-z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,10}$/;
  if (req.body.password && !passwordRegex.test(req.body.password)) {
    return next(
      new ErrorResponse(
        "Password must be 8-10 characters long, contain at least one number, one letter and one special character",
        400
      )
    );
  }

  //the fields are optional to update, so we need to build the query dynamically
  let query = "UPDATE user SET ";
  let values = [];
  //Updatable fields are email, password, groups.
  if (req.body.email) {
    query += "email = ?, ";
    values.push(req.body.email);
  } else if (req.body.email === undefined) {
    query += "email = ?, ";
    values.push(null);
  }
  if (req.body.password) {
    query += "password = ?, ";
    //bcrypt password with salt 10
    const hashedPassword = await bcrypt.hash(req.body.password, 10);
    values.push(hashedPassword);
  }
  if (req.body.group) {
    query += "`group_list` = ?, ";
    values.push(req.body.group);
  }
  //group can be empty, if it is empty we should update the group_list to empty
  if (req.body.group === "") {
    query += "`group_list` = ?, ";
    values.push("");
  }
  //remove the last comma and space
  query = query.slice(0, -2);
  //add the where clause
  query += " WHERE username = ?";
  values.push(req.params.username);
  const result = await connection.promise().execute(query, values);
  if (result[0].affectedRows === 0) {
    return next(new ErrorResponse("Failed to update user", 500));
  }

  res.status(200).json({
    success: true,
    message: "User updated successfully",
  });
});

// Update user email (user) => /controller/updateUserEmail/:username
exports.updateUserEmail = catchAsyncErrors(async (req, res, next) => {
  const username = req.user.username;
  const [row, fields] = await connection
    .promise()
    .query("SELECT * FROM user WHERE username = ?", [username]);
  if (row.length === 0) {
    return next(new ErrorResponse("User not found", 404));
  }

  const user = row[0];
  const result = await connection
    .promise()
    .execute("UPDATE user SET email = ? WHERE username = ?", [req.body.email, username]);
  if (result[0].affectedRows === 0) {
    return next(new ErrorResponse("Failed to update user", 500));
  }

  res.status(200).json({
    success: true,
    message: "User updated successfully",
  });
});

// Update user password (user) => /controller/updateUserPassword/:username
exports.updateUserPassword = catchAsyncErrors(async (req, res, next) => {
  const username = req.user.username;
  const [row, fields] = await connection
    .promise()
    .query("SELECT * FROM user WHERE username = ?", [username]);
  if (row.length === 0) {
    return next(new ErrorResponse("User not found", 404));
  }

  const user = row[0];
  //password constraint check
  const passwordRegex = /^(?=.*[a-z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,10}$/;
  if (!passwordRegex.test(req.body.password)) {
    return next(
      new ErrorResponse(
        "Password must be 8-10 characters long, contain at least one number, one letter and one special character",
        400
      )
    );
  }

  //bcrypt new password with salt 10
  const hashedPassword = await bcrypt.hash(req.body.password, 10);

  const result = await connection
    .promise()
    .execute("UPDATE user SET password = ? WHERE username = ?", [hashedPassword, username]);
  if (result[0].affectedRows === 0) {
    return next(new ErrorResponse("Failed to update user", 500));
  }

  sendToken(user, 200, res);
});

// Get all groups in usergroups table => /controller/getGroups
exports.getGroups = catchAsyncErrors(async (req, res, next) => {
  const [rows, fields] = await connection.promise().query("SELECT * FROM usergroups");
  if (rows.length === 0) {
    return next(new ErrorResponse("No groups found", 404));
  }
  res.status(200).json({
    success: true,
    data: rows,
  });
});

// Create and send token and save in cookie
const sendToken = (user, statusCode, res) => {
  // Create JWT Token
  const token = getJwtToken(user);
  // Options for cookie
  const options = {
    expires: new Date(Date.now() + process.env.COOKIE_EXPIRES_TIME * 24 * 60 * 60 * 1000),
    httpOnly: true,
  };

  // if(process.env.NODE_ENV === 'production ') {
  //     options.secure = true;
  // }

  res.status(statusCode).cookie("token", token, options).json({
    success: true,
    token,
    expire: process.env.COOKIE_EXPIRES_TIME,
  });
};

const getJwtToken = (user) => {
  return jwt.sign({ username: user.username }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_TIME,
  });
};
