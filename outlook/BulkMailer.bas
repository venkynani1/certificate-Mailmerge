Attribute VB_Name = "BulkMailer"
' ============================================================================
'  BulkMailer - send one personalised email per row, with its own attachment
'  For classic Outlook on Windows. Works with the ZIPs from Mail Merge Studio.
'
'  One-time setup:  Outlook > Alt+F11 > File > Import File... > BulkMailer.bas
'  Every event:     Extract the ZIP > Outlook > Alt+F8 > SendBulkMail > pick folder
'
'  The folder must contain:
'     mail-list.csv      header row + one row per person. Needs an "Email" column.
'                        Optional "File" column = attachment path relative to folder.
'                        Every column can be used in the text as {ColumnName}.
'     email-subject.txt  subject line with {placeholders}
'     email-body.html    body with {placeholders}
'     email-from.txt     (optional) shared mailbox to send on behalf of
'     email-cc.txt       (optional) CC address(es) for every mail
' ============================================================================
Option Explicit

Private Const PAUSE_SECONDS As Double = 1.5   ' gap between emails to avoid Exchange throttling

Public Sub SendBulkMail()
    Dim folder As String
    folder = PickFolder()
    If folder = "" Then Exit Sub
    If Right$(folder, 1) <> "\" Then folder = folder & "\"

    If Dir(folder & "mail-list.csv") = "" Then
        MsgBox "mail-list.csv not found in:" & vbCrLf & folder & vbCrLf & vbCrLf & _
               "Pick the folder you extracted the ZIP into.", vbExclamation, "Bulk Mailer"
        Exit Sub
    End If

    Dim rows As Collection
    Set rows = ParseCsv(ReadUtf8(folder & "mail-list.csv"))
    If rows.Count < 2 Then
        MsgBox "mail-list.csv has no people in it.", vbExclamation, "Bulk Mailer"
        Exit Sub
    End If

    Dim header As Variant: header = rows(1)
    Dim emailCol As Long, fileCol As Long, i As Long
    emailCol = -1: fileCol = -1
    For i = LBound(header) To UBound(header)
        Select Case LCase$(Trim$(header(i)))
            Case "email", "e-mail", "email id", "mail": emailCol = i
            Case "file", "attachment": fileCol = i
        End Select
    Next i
    If emailCol < 0 Then
        MsgBox "mail-list.csv needs an 'Email' column.", vbExclamation, "Bulk Mailer"
        Exit Sub
    End If

    Dim subjectTpl As String, bodyTpl As String, fromAddr As String, ccAddr As String
    subjectTpl = Trim$(Replace(Replace(ReadUtf8IfExists(folder & "email-subject.txt"), vbCr, ""), vbLf, " "))
    bodyTpl = ReadUtf8IfExists(folder & "email-body.html")
    fromAddr = Trim$(ReadUtf8IfExists(folder & "email-from.txt"))
    ccAddr = Trim$(ReadUtf8IfExists(folder & "email-cc.txt"))
    If subjectTpl = "" Then subjectTpl = "Your certificate"
    If bodyTpl = "" Then bodyTpl = "Dear {Name},<br><br>Please find your attachment.<br><br>Regards"

    ' Count recipients and check attachments before doing anything
    Dim total As Long, missing As Long, r As Long, row As Variant, missingList As String
    For r = 2 To rows.Count
        row = rows(r)
        If Trim$(Cell(row, emailCol)) <> "" Then
            total = total + 1
            If fileCol >= 0 Then
                If Trim$(Cell(row, fileCol)) <> "" Then
                    If Dir(folder & Cell(row, fileCol)) = "" Then
                        missing = missing + 1
                        If missing <= 5 Then missingList = missingList & vbCrLf & "  " & Cell(row, fileCol)
                    End If
                End If
            End If
        End If
    Next r
    If total = 0 Then
        MsgBox "No email addresses found in mail-list.csv.", vbExclamation, "Bulk Mailer"
        Exit Sub
    End If

    Dim msg As String
    msg = total & " email(s) ready." & vbCrLf & vbCrLf & _
          "Subject: " & subjectTpl & vbCrLf
    If fromAddr <> "" Then msg = msg & "From: " & fromAddr & vbCrLf
    If ccAddr <> "" Then msg = msg & "CC: " & ccAddr & vbCrLf
    If missing > 0 Then msg = msg & vbCrLf & "WARNING: " & missing & " attachment(s) not found (those rows will be skipped):" & missingList & vbCrLf
    msg = msg & vbCrLf & "YES  = send now" & vbCrLf & "NO   = save to Drafts so I can review" & vbCrLf & "CANCEL = stop"

    Dim choice As VbMsgBoxResult
    choice = MsgBox(msg, vbYesNoCancel + vbQuestion, "Bulk Mailer")
    If choice = vbCancel Then Exit Sub
    Dim sendNow As Boolean: sendNow = (choice = vbYes)

    Dim logText As String, sent As Long, failed As Long, skipped As Long
    logText = "Name,Email,Status,Detail" & vbCrLf

    Dim mailItem As Object, toAddr As String, attachPath As String, nm As String
    For r = 2 To rows.Count
        row = rows(r)
        toAddr = Trim$(Cell(row, emailCol))
        nm = CellByName(header, row, "Name")
        If toAddr = "" Then
            skipped = skipped + 1
            logText = logText & CsvQ(nm) & ",,skipped,no email" & vbCrLf
            GoTo NextRow
        End If

        attachPath = ""
        If fileCol >= 0 Then
            If Trim$(Cell(row, fileCol)) <> "" Then
                attachPath = folder & Cell(row, fileCol)
                If Dir(attachPath) = "" Then
                    failed = failed + 1
                    logText = logText & CsvQ(nm) & "," & CsvQ(toAddr) & ",failed,attachment not found: " & CsvQ(Cell(row, fileCol)) & vbCrLf
                    GoTo NextRow
                End If
            End If
        End If

        On Error GoTo SendErr
        Set mailItem = Application.CreateItem(0)   ' olMailItem
        With mailItem
            .To = toAddr
            If ccAddr <> "" Then .CC = ccAddr
            If fromAddr <> "" Then .SentOnBehalfOfName = fromAddr
            .Subject = Fill(subjectTpl, header, row, False)
            .HTMLBody = Fill(bodyTpl, header, row, True)
            If attachPath <> "" Then .Attachments.Add attachPath
            If sendNow Then .Send Else .Save
        End With
        On Error GoTo 0
        sent = sent + 1
        logText = logText & CsvQ(nm) & "," & CsvQ(toAddr) & "," & IIf(sendNow, "sent", "draft") & "," & CsvQ(Cell(row, IIf(fileCol >= 0, fileCol, emailCol))) & vbCrLf
        Set mailItem = Nothing
        If sendNow Then Pause PAUSE_SECONDS Else DoEvents
        GoTo NextRow

SendErr:
        failed = failed + 1
        logText = logText & CsvQ(nm) & "," & CsvQ(toAddr) & ",failed," & CsvQ(Err.Description) & vbCrLf
        Set mailItem = Nothing
        Resume NextRow
NextRow:
    Next r

    WriteUtf8 folder & "send-log.csv", logText
    MsgBox IIf(sendNow, "Sent: ", "Saved to Drafts: ") & sent & vbCrLf & _
           "Failed: " & failed & vbCrLf & "Skipped (no email): " & skipped & vbCrLf & vbCrLf & _
           "Details: " & folder & "send-log.csv", vbInformation, "Bulk Mailer"
End Sub

' ---------------------------------------------------------------- helpers
Private Function PickFolder() As String
    Dim sh As Object, f As Object
    Set sh = CreateObject("Shell.Application")
    Set f = sh.BrowseForFolder(0, "Select the folder you extracted the ZIP into (it contains mail-list.csv)", &H41)
    If f Is Nothing Then Exit Function
    PickFolder = f.Self.Path
End Function

Private Function Fill(ByVal tpl As String, header As Variant, row As Variant, asHtml As Boolean) As String
    Dim i As Long, v As String
    For i = LBound(header) To UBound(header)
        v = Cell(row, i)
        If LCase$(Trim$(header(i))) = "name" And Trim$(v) = "" Then v = "Participant"
        If asHtml Then v = HtmlEsc(v)
        tpl = Replace(tpl, "{" & Trim$(header(i)) & "}", v, , , vbTextCompare)
    Next i
    Fill = tpl
End Function

Private Function Cell(row As Variant, ByVal idx As Long) As String
    If idx < LBound(row) Or idx > UBound(row) Then Cell = "" Else Cell = CStr(row(idx))
End Function

Private Function CellByName(header As Variant, row As Variant, ByVal colName As String) As String
    Dim i As Long
    For i = LBound(header) To UBound(header)
        If LCase$(Trim$(header(i))) = LCase$(colName) Then CellByName = Cell(row, i): Exit Function
    Next i
End Function

Private Function HtmlEsc(ByVal s As String) As String
    s = Replace(s, "&", "&amp;")
    s = Replace(s, "<", "&lt;")
    HtmlEsc = Replace(s, ">", "&gt;")
End Function

Private Function CsvQ(ByVal s As String) As String
    CsvQ = """" & Replace(s, """", """""") & """"
End Function

Private Sub Pause(ByVal seconds As Double)
    Dim t As Double: t = Timer
    Do While Timer - t < seconds And Timer >= t
        DoEvents
    Loop
End Sub

Private Function ReadUtf8(ByVal path As String) As String
    Dim st As Object
    Set st = CreateObject("ADODB.Stream")
    st.Type = 2: st.Charset = "utf-8": st.Open
    st.LoadFromFile path
    ReadUtf8 = st.ReadText
    st.Close
    If Len(ReadUtf8) > 0 Then If AscW(Left$(ReadUtf8, 1)) = &HFEFF Then ReadUtf8 = Mid$(ReadUtf8, 2)
End Function

Private Function ReadUtf8IfExists(ByVal path As String) As String
    If Dir(path) <> "" Then ReadUtf8IfExists = ReadUtf8(path)
End Function

Private Sub WriteUtf8(ByVal path As String, ByVal text As String)
    On Error Resume Next
    Dim st As Object
    Set st = CreateObject("ADODB.Stream")
    st.Type = 2: st.Charset = "utf-8": st.Open
    st.WriteText text
    st.SaveToFile path, 2
    st.Close
End Sub

' Minimal RFC-4180 CSV parser -> Collection of 0-based string arrays
Private Function ParseCsv(ByVal text As String) As Collection
    Dim rows As New Collection, fields() As String, n As Long
    Dim i As Long, ch As String, cur As String, inQ As Boolean, L As Long
    L = Len(text)
    ReDim fields(0): n = 0
    i = 1
    Do While i <= L
        ch = Mid$(text, i, 1)
        If inQ Then
            If ch = """" Then
                If i < L And Mid$(text, i + 1, 1) = """" Then
                    cur = cur & """": i = i + 1
                Else
                    inQ = False
                End If
            Else
                cur = cur & ch
            End If
        Else
            Select Case ch
                Case """": inQ = True
                Case ",": ReDim Preserve fields(n): fields(n) = cur: n = n + 1: cur = ""
                Case vbCr
                Case vbLf
                    ReDim Preserve fields(n): fields(n) = cur
                    If n > 0 Or Trim$(cur) <> "" Then rows.Add fields
                    ReDim fields(0): n = 0: cur = ""
                Case Else: cur = cur & ch
            End Select
        End If
        i = i + 1
    Loop
    If n > 0 Or Trim$(cur) <> "" Then ReDim Preserve fields(n): fields(n) = cur: rows.Add fields
    Set ParseCsv = rows
End Function
