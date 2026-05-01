// @ts-check
//
// Thread / inline-comment management for the Overleaf chat service.
// Upstream CE registers no routes for these endpoints — they exist only in
// Server Pro modules. We expose them here so the (CE) Review Panel and our
// Claude Review feature can create / resolve / delete comment threads.

import { expressify } from '@overleaf/promise-utils'
import ChatApiHandler from './ChatApiHandler.mjs'
import ChatManager from './ChatManager.mjs'
import EditorRealTimeController from '../Editor/EditorRealTimeController.mjs'
import SessionManager from '../Authentication/SessionManager.mjs'
import UserInfoManager from '../User/UserInfoManager.mjs'
import UserInfoController from '../User/UserInfoController.mjs'

async function getThreads(req, res) {
  const { project_id: projectId } = req.params
  const threads = await ChatApiHandler.promises.getThreads(projectId)
  await ChatManager.promises.injectUserInfoIntoThreads(threads)
  res.json(threads)
}

async function sendComment(req, res) {
  const { project_id: projectId, thread_id: threadId } = req.params
  const { content } = req.body
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (userId == null) {
    return res.status(401).json({ error: 'no logged-in user' })
  }
  const message = await ChatApiHandler.promises.sendComment(
    projectId,
    threadId,
    userId,
    content
  )
  const user = await UserInfoManager.promises.getPersonalInfo(message.user_id)
  message.user = UserInfoController.formatPersonalInfo(user)
  EditorRealTimeController.emitToRoom(
    projectId,
    'new-comment',
    threadId,
    message
  )
  res.json(message)
}

async function resolveThread(req, res) {
  const { project_id: projectId, thread_id: threadId } = req.params
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (userId == null) {
    return res.status(401).json({ error: 'no logged-in user' })
  }
  await ChatApiHandler.promises.resolveThread(projectId, threadId, userId)
  EditorRealTimeController.emitToRoom(
    projectId,
    'resolve-thread',
    threadId,
    userId
  )
  res.sendStatus(204)
}

async function reopenThread(req, res) {
  const { project_id: projectId, thread_id: threadId } = req.params
  await ChatApiHandler.promises.reopenThread(projectId, threadId)
  EditorRealTimeController.emitToRoom(projectId, 'reopen-thread', threadId)
  res.sendStatus(204)
}

async function deleteThread(req, res) {
  const { project_id: projectId, thread_id: threadId } = req.params
  await ChatApiHandler.promises.deleteThread(projectId, threadId)
  EditorRealTimeController.emitToRoom(projectId, 'delete-thread', threadId)
  res.sendStatus(204)
}

async function editMessage(req, res) {
  const {
    project_id: projectId,
    thread_id: threadId,
    message_id: messageId,
  } = req.params
  const { content } = req.body
  const userId = SessionManager.getLoggedInUserId(req.session)
  if (userId == null) {
    return res.status(401).json({ error: 'no logged-in user' })
  }
  await ChatApiHandler.promises.editMessage(
    projectId,
    threadId,
    messageId,
    userId,
    content
  )
  EditorRealTimeController.emitToRoom(
    projectId,
    'edit-message',
    threadId,
    messageId,
    content
  )
  res.sendStatus(204)
}

async function deleteMessage(req, res) {
  const {
    project_id: projectId,
    thread_id: threadId,
    message_id: messageId,
  } = req.params
  await ChatApiHandler.promises.deleteMessage(projectId, threadId, messageId)
  EditorRealTimeController.emitToRoom(
    projectId,
    'delete-message',
    threadId,
    messageId
  )
  res.sendStatus(204)
}

export default {
  getThreads: expressify(getThreads),
  sendComment: expressify(sendComment),
  resolveThread: expressify(resolveThread),
  reopenThread: expressify(reopenThread),
  deleteThread: expressify(deleteThread),
  editMessage: expressify(editMessage),
  deleteMessage: expressify(deleteMessage),
}
