
function xformAjaxAdapter (formName, preloadData) {
  this.formName = formName;
  this.preloadData = preloadData;
  this.session_id = -1;

  this.loadForm = function () {
    adapter = this;
    jQuery.post(XFORM_URL, JSON.stringify({'action': 'new-form', 
                                           'form-name': this.formName,
                                           'preloader-data': this.preloadData}),
      function (resp) {
        adapter.session_id = resp["session_id"];
        adapter._renderEvent(resp["event"], true);
      },
      "json");
  }


  this.NEW_REPEATS = true;
  this.answerQuestion = function (answer) {
    adapter = this;
    if (activeQuestion["type"] == "repeat-juncture") {
      //ugh, we _really_ need dictionary based select questions
      var addIx = (activeQuestion["add-choice"] != null ? activeQuestion["repetitions"].length + 1 : -1);
      var delIx = (activeQuestion["del-choice"] != null ? activeQuestion["choices"].length - 1 : -1);
      var doneIx = activeQuestion["choices"].length;

      if (answer == null) {
        showError("An answer is required");
      } else if (answer <= activeQuestion["repetitions"].length) {
        jQuery.post(XFORM_URL, JSON.stringify({'action': (activeQuestion["repeat-delete"] ? 'delete-repeat' :'edit-repeat'), 
                'session-id': this.session_id, 'ix': answer}),
          function (resp) {
            adapter._renderEvent(resp["event"], true);
          },
          "json");
      } else if (answer == addIx) {
        jQuery.post(XFORM_URL, JSON.stringify({'action': 'new-repeat', 'session-id': this.session_id}),
          function (resp) {
            adapter._renderEvent(resp["event"], true);
          },
          "json");
      } else if (answer == delIx) {
        activeQuestion["repeat-delete"] = true;
        this._renderEvent(activeQuestion, true);
      } else if (answer == doneIx) {
        this._step(true);
      } else {
        alert('oops');
      }
    } else if (activeQuestion["repeatable"]) {
      if (answer == 1 && !activeQuestion["exists"]) {
        //create repeat
        jQuery.post(XFORM_URL, JSON.stringify({'action': 'add-repeat', 'session-id': this.session_id}),
          function (resp) {
            adapter._renderEvent(resp["event"], true);
          },
          "json");
      } else if (answer == 2 && activeQuestion["exists"]) {
        //delete repeat
        alert('i should probably delete all the subsequent existing repeats here, but i don\'t support that currently. also, that\'s probably not the best user interaction');
        this._step(true);
      } else {
        //nothing changed; advance
        this._step(true);
      }
    } else {
      jQuery.post(XFORM_URL, JSON.stringify({'action': 'answer',
                                             'session-id': this.session_id,
                                             'answer': answer}),
        function (resp) {
          if (resp["status"] == "validation-error") {
            if (resp["type"] == "required") {
              showError("An answer is required");
            } else if (resp["type"] == "constraint") {
              showError(resp["reason"]);      
            }
          } else {
            adapter._renderEvent(resp["event"], true);
          }
        },
        "json");
    }
  }

  this.prevQuestion = function () {
    this._step(false);
  }

  this._renderEvent = function (event, dirForward) {
    if (event["type"] == "question") {
      if (event["style"]["domain"])
        event["domain"] = event["style"]["domain"];

      renderQuestion(event, dirForward);
    } else if (event["type"] == "form-complete") {
      this._formComplete(event);
    } else if (event["type"] == "sub-group") {
      if (!this.NEW_REPEATS && event["repeatable"]) {
        event["item"] = event["caption"];
        event["caption"] = "Add a " + event["item"] + "?";
        event["datatype"] = "select";
        event["choices"] = ["Yes", "No"];
        event["answer"] = (event["exists"] ? 1 : (dirForward ? null : 2));
        event["required"] = true;

        renderQuestion(event, dirForward);
      } else {
        this._step(dirForward);
      }
    } else if (event["type"] == "repeat-juncture") {
      if (!event["repeat-delete"]) {
        event["caption"] = event["main-header"];
        event["datatype"] = "select";
        
        var options = []
        for (var i = 0; i < event["repetitions"].length; i++) {
          options.push(event["repetitions"][i]);
        }
        if (event["add-choice"] != null) {
          options.push(event["add-choice"]);
        }
        if (event["del-choice"] != null) {
          options.push(event["del-choice"]);
        }
        options.push(event["done-choice"]);
        
        event["choices"] = options;
        event["answer"] = null;
        event["required"] = true;
      } else {
        event["caption"] = event["del-header"];
        event["datatype"] = "select";
        
        var options = []
        for (var i = 0; i < event["repetitions"].length; i++) {
          options.push(event["repetitions"][i]);
        }
        event["choices"] = options;
        event["answer"] = null;
        event["required"] = true;  
      }

      renderQuestion(event, dirForward);
    } else {
      alert("unrecognized event [" + event["type"] + "]");
    }
  }

  this._step = function (dirForward) {
    BACK_AT_START_ABORTS = true;

    //handle 'which repeat to delete?' interstitial
    if (!dirForward && activeQuestion["repeat-delete"]) {
      activeQuestion["repeat-delete"] = false;
      this._renderEvent(activeQuestion, false);
      return;
    }

    adapter = this;
    jQuery.post(XFORM_URL, JSON.stringify({'action': (dirForward ? 'next' : 'back'),
                                           'session-id': this.session_id}),
      function (resp) {
        if (!dirForward && resp["at-start"] && BACK_AT_START_ABORTS) {
          adapter.abort();
        } else {
          adapter._renderEvent(resp["event"], dirForward || resp["at-start"]);
        }
      },
      "json");
  }

  this._formComplete = function (params, path, method) {
    submit_redirect(params, path, method);
  }

  this.abort = function () {
    submit_redirect({type: 'form-aborted'});
  }

  this.quitWarning = function () {
    return {
      'main': 'This form isn\'t finished! If you go HOME, you will throw out this form.',
      'quit': 'Go HOME; discard form',
      'cancel': 'Stay and finish form'
    }
  }
}

function Workflow (flow, onFinish) {
  this.flow = flow;
  this.onFinish = onFinish;
  this.data = null;

  this.start = function () {
    this.data = {}
    return this.flow(this.data);
  }

  this.finish = function () {
    this.onFinish(this.data);
  }

  this.abort = function () {
    this.start();
    this.finish();
  }
}

function wfQuestion (caption, type, answer, choices, required, validation, helptext, domain, custom_layout) {
  this.caption = caption;
  this.type = type;
  this.value = answer || null;
  this.choices = choices;
  this.required = required || false;
  this.validation = validation || function (ans) { return null; };
  this.domain = domain;
  this.custom_layout = custom_layout;
  this.helptext = helptext;

  this.to_q = function () {
    return {'caption': this.caption,
            'datatype': this.type,
            'answer': this.value,
            'choices': this.choices,
            'required': this.required,
            'help': this.helptext,
            'domain': this.domain,
            'customlayout': this.custom_layout};
  }

  this.validate = function () {
    if (this.required && this.value == null) {
      return "An answer is required";
    } else if (this.value != null) {
      return this.validation(this.value);
    }
  }
}

function wfQuery (query) {
  this.query = query;
  this.value = null;
  this.eval = function () {
    this.value = this.query();
  }
}

function wfAsyncQuery (query) {
  this.query = query;
  this.value = null;

  this.eval = function (callback) {
    queryObj = this;
    this.query(function (val) {
        queryObj.value = val;
        callback();
      });
  }
}

function wfAlert (message) {
  this.message = message;

  this.to_q = function () {
    return {'caption': this.message,
            'datatype': 'info'};
  }
}

function workflowAdapter (workflow) {
  this.wf = workflow;

  this.wf_inst = null;
  this.history = null;
  this.active_question = null;

  this.loadForm = function () {
    this.wf_inst = this.wf.start();
    this.history = [];
    this.active_question = null;

    this._jumpNext();
  }

  this.answerQuestion = function (answer) {
    //type = this.active_question.type;
    //if (type == 'date')
    //  answer = new Date(answer);

    this.active_question.value = answer;

    var val_error = null;
    if (this.active_question instanceof wfQuestion) {
      val_error = this.active_question.validate();
    }

    if (val_error == null) {
      this._push_hist(answer, this.active_question);
    } else {
      showError(val_error);
    }
  }

  this.prevQuestion = function () {
    hist_length = this.history.length;
    while (hist_length > 0 && !this.history[hist_length - 1][0]) {
      hist_length--;
    }

    if (hist_length == 0) {
      this.wf.abort();
      return;
    }

    this.wf_inst = this.wf.start();
    for (var i = 0; i < hist_length; i++) {
      ev = this._getNext();
      ev.value = this.history[i][1];
      if (i == hist_length - 1) {
        this._activateQuestion(ev, false);
      }
    }

    while (this.history.length > hist_length - 1)
      this.history.pop();
  }

  this._getNext = function () {
    try {
      return this.wf_inst.next();
    } catch (e) {
      if (e instanceof StopIteration) {
        return null;
      } else {
        throw e;
      }
    }
  }

  this._jumpNext = function () {
    ev = this._getNext();
    if (ev == null) {
      this._formComplete();
    } else if (ev instanceof wfQuestion) {
      this._activateQuestion(ev, true);
    } else if (ev instanceof wfQuery) {
      ev.eval();
      this._push_hist(ev.value, ev);
    } else if (ev instanceof wfAsyncQuery) {
      self = this;
      ev.eval(function () { self._push_hist(ev.value, ev); });
    } else if (ev instanceof wfAlert) {
      this._activateQuestion(ev, true);
    }
  }

  this._activateQuestion = function (ev, dir) {
    this.active_question = ev;
    renderQuestion(ev.to_q(), dir);
  }

  this._push_hist = function (answer, ev) {
    this.history.push([ev instanceof wfQuestion, answer]);
    this._jumpNext();
  }

  this._formComplete = function () {
    this.wf.finish();
  }

  this.abort = function () {
    this.wf.abort();
  }

  this.quitWarning = function () {
    if (this.wf.quitWarning) {
      return this.wf.quitWarning();
    } else {
      return {
        'main': 'You aren\'t finished yet. If you go HOME, you will throw out the answers you have entered so far.',
        'quit': 'Go HOME',
        'cancel': 'Stay and finish'
      }
    }
  }

}

function renderQuestion (event, dir) {
  activeQuestion = event;

  SHOW_ALERTS_ON_BACK = false;
  if (event["datatype"] == "info") {
    if (dir || SHOW_ALERTS_ON_BACK) {
      showAlert(event["caption"], dir ? nextClicked : backClicked);
    } else {
      backClicked();
    }
    return;
  }

  questionCaption.setText(event["caption"]);
 
  if (event["customlayout"] != null) {
    event["customlayout"](event);
  } else if (event["datatype"] == "str" ||
             event["datatype"] == "int" ||
             event["datatype"] == "float" ||
             event["datatype"] == "passwd") {
    questionEntry.update(freeEntry);

    if (event["datatype"] == "passwd") {
      answerWidget = passwdAnswer;
      entryWidget = passwdText;
    } else {
      answerWidget = freeTextAnswer;
      entryWidget = answerText;
    }
    entryWidget.setMaxLen(500);

    answerBar.update(answerWidget);

    if (event["datatype"] == "str" || event["datatype"] == "passwd") {
      if (event["domain"] == "alpha") {
        kbd = keyboardAlphaOnly;
      } else if (event["domain"] == "numeric" || event["domain"] == "pat-id") {
        kbd = numPad;
      } else if (event["domain"] == "bp") {
        kbd = numPadBP;
      } else if (event["domain"] == "phone") {
        kbd = numPadPhone;
      } else {
        kbd = keyboard;
      }

      if (event["domain"] == "pat-id" && event["answer"] == null) {
        event["answer"] = CLINIC_PREFIX;
      }
    } else if (event["datatype"] == "int") {
      kbd = numPad;
      entryWidget.setMaxLen(9);
    } else if (event["datatype"] == "float") {
      kbd = numPadDecimal;
    }

    freeEntryKeyboard.update(kbd);    
    activeInputWidget = entryWidget;
    
    if (event["answer"] != null) {
      entryWidget.setText(event["answer"]);
    }
  } else if (event["datatype"] == "select" || event["datatype"] == "multiselect") {
    selections = normalize_select_answer(event["answer"], event["datatype"] == "multiselect");
    chdata = choiceSelect(event["choices"], selections, event["datatype"] == "multiselect");
    questionEntry.update(chdata[0]);
    activeInputWidget = chdata[1];
  } else if (event["datatype"] == "date") {
    dateEntryContext = new DateWidgetContext(dir, event["answer"]);
    dateEntryContext.refresh();
  } else {
    alert("unrecognized datatype [" + event["datatype"] + "]");
  }

  if (event["answer"] == null) {
    clearClicked();
  }
}

function getQuestionAnswer () {
  type = activeQuestion["datatype"];

  if (type == "str" || type == "int" || type == "float" || type == "passwd") {
    var val = activeInputWidget.child.control.value;
    if (val == "") {
      return null;
    } else if (type == "str" || type == "passwd") {
      return val;
    } else {
      return +val;
    }
  } else if (type == "select" || type == "multiselect") {
    selected = [];
    for (i = 0; i < activeInputWidget.length; i++) {
      if (activeInputWidget[i].status == 'selected') {
        selected.push(getButtonID(activeInputWidget[i]));
      }
    }
    
    if (type == "select") {
      return selected.length > 0 ? selected[0] : null;
    } else {
      return selected;
    }
  } else if (type == "date") {
    return dateEntryContext.getDate();
  } else if (type == "info") {
    return null;
  }
}

function normalize_select_answer (ans, multi) {
  if (ans != null) {
    return (!multi ? [ans] : ans);
  } else {
    return null;
  }
}

function answerQuestion () {
  gFormAdapter.answerQuestion(getQuestionAnswer());
}

function prevQuestion () {
  gFormAdapter.prevQuestion();
}

function submit_redirect(params, path, method) {
  // hat tip: http://stackoverflow.com/questions/133925/javascript-post-request-like-a-form-submit
  method = method || "post"; // Set method to post by default, if not specified.
  path = path || "";
  // The rest of this code assumes you are not using a library.
  // It can be made less wordy if you use one.
  var form = document.createElement("form");
  form.setAttribute("method", method);
  form.setAttribute("action", path);
  
  for(var key in params) {
    var hiddenField = document.createElement("input");
    hiddenField.setAttribute("type", "hidden");
    hiddenField.setAttribute("name", key);
    hiddenField.setAttribute("value", params[key]);
    
    form.appendChild(hiddenField);
  }
  // required for FF 3+ compatibility
  document.body.appendChild(form);
  form.submit();
}