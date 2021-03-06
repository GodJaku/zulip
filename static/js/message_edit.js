var message_edit = (function () {
var exports = {};
var currently_editing_messages = {};


// Returns true if the edit task should end.
exports.save = function (row, from_topic_edited_only) {
    var msg_list = current_msg_list;
    var message_id;

    if (row.hasClass('recipient_row')) {
        message_id = rows.id_for_recipient_row(row);
    } else {
        message_id = rows.id(row);
    }
    var message = current_msg_list.get(message_id);
    var changed = false;

    var new_content = row.find(".message_edit_content").val();
    var topic_changed = false;
    var new_topic;
    if (message.type === "stream") {
        new_topic = row.find(".message_edit_topic").val();
        topic_changed = (new_topic !== message.subject && new_topic.trim() !== "");
    }

    // Editing a not-yet-acked message (because the original send attempt failed)
    // just results in the in-memory message being changed
    if (message.local_id !== undefined) {
        // No changes
        if (new_content === message.raw_content && !topic_changed) {
            return true;
        }
        echo.edit_locally(message, new_content, topic_changed ? new_topic : undefined);
        return true;
    }

    var request = {message_id: message.id};
    if (topic_changed) {
        request.subject = new_topic;
        if (feature_flags.propagate_topic_edits) {
            var selected_topic_propagation = row.find("select.message_edit_topic_propagate").val() || "change_later";
            request.propagate_mode = selected_topic_propagation;
        }
        changed = true;
    }

    if (new_content !== message.raw_content && !from_topic_edited_only) {
        request.content = new_content;
        message.is_me_message = new_content.lastIndexOf('/me', 0) === 0;
        changed = true;
    }
    if (!changed) {
        // If they didn't change anything, just cancel it.
        return true;
    }
    channel.post({
        url: '/json/update_message',
        data: request,
        success: function (data) {
            if (msg_list === current_msg_list) {
                return true;
            }
        },
        error: function (xhr, error_type, xhn) {
            var message = channel.xhr_error_message("Error saving edit", xhr);
            row.find(".edit_error").text(message).show();
        }
    });
    // The message will automatically get replaced when it arrives.
};

function handle_edit_keydown(from_topic_edited_only, e) {
    var row, code = e.keyCode || e.which;

    if (e.target.id === "message_edit_content" && code === 13 &&
        (e.metaKey || e.ctrlKey)) {
        row = $(".message_edit_content").filter(":focus").closest(".message_row");
        if (message_edit.save(row, from_topic_edited_only) === true) {
            message_edit.end(row);
        }
    } else if (e.target.id === "message_edit_topic" && code === 13) {
        // Hitting enter in topic field isn't so great.
        e.stopPropagation();
        e.preventDefault();
    }
}

function timer_text(seconds_left) {
    var minutes = Math.floor(seconds_left / 60);
    var seconds = seconds_left % 60;
    if (minutes >= 1) {
        return i18n.t("__minutes__ min to edit", {'minutes': minutes.toString()});
    } else if (seconds_left >= 10) {
        return i18n.t("__seconds__ sec to edit", {'seconds': (seconds - seconds % 5).toString()});
    }
    return i18n.t("__seconds__ sec to edit", {'seconds': seconds.toString()});
}

function edit_message (row, raw_content) {
    var content_top = row.find('.message_content')[0]
        .getBoundingClientRect().top;

    var message = current_msg_list.get(rows.id(row));
    var edit_row = row.find(".message_edit");
    var form = $(templates.render('message_edit_form',
                                  {is_stream: message.is_stream,
                                   topic: message.subject,
                                   content: raw_content,
                                   minutes_to_edit: Math.floor(page_params.realm_message_content_edit_limit_seconds / 60)}));

    var edit_obj = {form: form, raw_content: raw_content};
    var original_topic = message.subject;

    current_msg_list.show_edit_message(row, edit_obj);

    form.keydown(_.partial(handle_edit_keydown, false));

    // We potentially got to this function by clicking a button that implied the
    // user would be able to edit their message.  Give a little bit of buffer in
    // case the button has been around for a bit, e.g. we show the
    // edit_content_button (hovering pencil icon) as long as the user would have
    // been able to click it at the time the mouse entered the message_row. Also
    // a buffer in case their computer is slow, or stalled for a second, etc
    // If you change this number also change edit_limit_buffer in
    // zerver.views.messages.update_message_backend
    var seconds_left_buffer = 5;

    var now = new XDate();
    var seconds_left = page_params.realm_message_content_edit_limit_seconds +
        now.diffSeconds(message.timestamp * 1000);
    var can_edit_content = (page_params.realm_message_content_edit_limit_seconds === 0) ||
        (seconds_left + seconds_left_buffer > 0);
    if (!can_edit_content) {
        row.find('textarea.message_edit_content').attr("disabled","disabled");
    }

    // If we allow editing at all, give them at least 10 seconds to do it.
    // If you change this number also change edit_limit_buffer in
    // zerver.views.messages.update_message_backend
    var min_seconds_to_edit = 10;
    seconds_left = Math.floor(Math.max(seconds_left, min_seconds_to_edit));

    if (page_params.realm_message_content_edit_limit_seconds > 0) {
        row.find('.message-edit-timer-control-group').show();
        $('#message_edit_tooltip').tooltip({ animation: false, placement: 'left',
                                             template: '<div class="tooltip" role="tooltip"><div class="tooltip-arrow"></div><div class="tooltip-inner message-edit-tooltip-inner"></div></div>'});
        var timer_row = row.find('.message_edit_countdown_timer');
        if (can_edit_content) {  // Add a visual timer
            // I believe these need to be defined outside the countdown_timer, since
            // row just refers to something like the currently selected message, and
            // can change out from under us
            var message_content_row = row.find('textarea.message_edit_content');
            var message_topic_row, message_topic_propagate_row;
            if (message.is_stream) {
                message_topic_row = row.find('input.message_edit_topic');
                message_topic_propagate_row = row.find('select.message_edit_topic_propagate');
            }
            var message_save_row = row.find('button.message_edit_save');
            // Do this right away, rather than waiting for the timer to do its first update,
            // since otherwise there is a noticeable lag
            timer_row.text(timer_text(seconds_left));
            var countdown_timer = setInterval(function () {
                if (--seconds_left <= 0) {
                    clearInterval(countdown_timer);
                    message_content_row.attr("disabled","disabled");
                    if (message.is_stream) {
                        message_topic_row.attr("disabled","disabled");
                        message_topic_propagate_row.hide();
                    }
                    // We don't go directly to "Topic editing only" state (with an active Save button),
                    // since it isn't clear what to do with the half-finished edit. It's nice to keep
                    // the half-finished edit around so that they can copy-paste it, but we don't want
                    // people to think "Save" will save the half-finished edit.
                    message_save_row.addClass("disabled");
                    timer_row.text(i18n.t("Time's up!"));
                } else {
                    timer_row.text(timer_text(seconds_left));
                }
            }, 1000);
        } else { // otherwise, give a hint as to why you can edit the topic but not the message content
            timer_row.text(i18n.t("Topic editing only"));
        }
    }

    currently_editing_messages[message.id] = edit_obj;
    if ((message.type === 'stream' && message.subject === compose.empty_topic_placeholder()) ||
        !can_edit_content) {
        edit_row.find(".message_edit_topic").focus();
    } else {
        edit_row.find(".message_edit_content").focus();
    }

    // Scroll to keep the message content in the same place
    var edit_top = edit_row.find('.message_edit_content')[0]
        .getBoundingClientRect().top;

    var scroll_by = edit_top - content_top + 5 /* border and padding */;
    edit_obj.scrolled_by = scroll_by;
    viewport.scrollTop(viewport.scrollTop() + scroll_by);

    if (feature_flags.propagate_topic_edits && message.local_id === undefined) {
        var topic_input = edit_row.find(".message_edit_topic");
        topic_input.keyup( function () {
            var new_topic = topic_input.val();
            row.find('.message_edit_topic_propagate').toggle(new_topic !== original_topic);
        });
    }

    composebox_typeahead.initialize_compose_typeahead("#message_edit_content", {emoji: true});

}

function start_edit_maintaining_scroll(row, content) {
    edit_message(row, content);
    var row_bottom = row.height() + row.offset().top;
    var composebox_top = $("#compose").offset().top;
    if (row_bottom > composebox_top) {
        viewport.scrollTop(viewport.scrollTop() + row_bottom - composebox_top);
    }
}

exports.start = function (row) {
    var message = current_msg_list.get(rows.id(row));
    var msg_list = current_msg_list;
    channel.post({
        url: '/json/fetch_raw_message',
        idempotent: true,
        data: {message_id: message.id},
        success: function (data) {
            if (current_msg_list === msg_list) {
                message.raw_content = data.raw_content;
                start_edit_maintaining_scroll(row, data.raw_content);
            }
        }
    });
};

exports.start_local_failed_edit = function (row, message) {
    start_edit_maintaining_scroll(row, message.raw_content);
};

exports.start_topic_edit = function (recipient_row) {
    var form = $(templates.render('topic_edit_form'));
    current_msg_list.show_edit_topic(recipient_row, form);
    form.keydown(_.partial(handle_edit_keydown, true));
    var msg_id = rows.id_for_recipient_row(recipient_row);
    var message = current_msg_list.get(msg_id);
    var topic = message.subject;
    if (topic === compose.empty_topic_placeholder()) {
        topic = '';
    }
    form.find(".message_edit_topic").val(topic).select().focus();
};

exports.is_editing = function (id) {
    return currently_editing_messages[id] !== undefined;
};

exports.end = function (row) {
    var message = current_msg_list.get(rows.id(row));
    if (message !== undefined &&
        currently_editing_messages[message.id] !== undefined) {
        var scroll_by = currently_editing_messages[message.id].scrolled_by;
        viewport.scrollTop(viewport.scrollTop() - scroll_by);
        delete currently_editing_messages[message.id];
        current_msg_list.hide_edit_message(row);
    }
};

exports.maybe_show_edit = function (row, id) {
    if (currently_editing_messages[id] !== undefined) {
        current_msg_list.show_edit_message(row, currently_editing_messages[id]);
    }
};

$(document).on('narrow_deactivated.zulip', function (event) {
    _.each(currently_editing_messages, function (elem, idx) {
        if (current_msg_list.get(idx) !== undefined) {
            var row = current_msg_list.get_row(idx);
            current_msg_list.show_edit_message(row, elem);
        }
    });
});

return exports;
}());
