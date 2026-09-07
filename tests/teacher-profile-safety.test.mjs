import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSafeTeacherProfile, enrichScheduleProfiles } from '../edge-functions/api/chat.js';

test('only returns a teacher profile after it is explicitly verified', () => {
  assert.equal(
    buildSafeTeacherProfile({ name: '张老师', profile: '已核验的师资简介。', profile_status: 'verified' }),
    '已核验的师资简介。'
  );
  assert.equal(
    buildSafeTeacherProfile({ name: '张老师', profile: '尚待核验的简介。', profile_status: 'pending' }),
    ''
  );
  assert.equal(
    buildSafeTeacherProfile({ name: '张老师', research_topics: '数字金融', profile_status: 'derived' }),
    ''
  );
});

test('removes model-provided profiles when no verified library profile matches', () => {
  const plan = { formal_schedule: [{ teacher_name: '张老师', teacher_profile: '模型补写的简介' }] };
  enrichScheduleProfiles(plan, [{ teacher_name: '张老师', course_title: '课程A', teacher_profile: '' }]);
  assert.equal(plan.formal_schedule[0].teacher_profile, '');
});
