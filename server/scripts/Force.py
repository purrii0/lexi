from manim import *

class Force(Scene):
    def construct(self):
        # Ground
        ground = Line(start=LEFT*5, end=RIGHT*5, color=WHITE)
        self.play(Create(ground))
        
        # Ball
        ball = Dot(point=ORIGIN, radius=0.2, color=BLUE)
        self.play(Create(ball))
        
        # Force arrow
        force_arrow = Arrow(start=ball.get_center(), end=ball.get_center() + RIGHT*2, buff=0, color=RED)
        self.play(Create(force_arrow))
        
        # Text label F
        text_label_F = Tex("F").next_to(ball, UP, buff=0.3)
        self.play(Create(text_label_F))
        
        # Velocity arrow (initial length 1)
        velocity_arrow = Arrow(start=ball.get_center(), end=ball.get_center() + RIGHT*1, buff=0, color=GREEN)
        self.play(Create(velocity_arrow))
        
        # Acceleration arrow
        acceleration_arrow = Arrow(start=ball.get_center(), end=ball.get_center() + RIGHT*1.5, buff=0, color=YELLOW)
        self.play(Create(acceleration_arrow))
        
        # Text labels a and m near ball
        text_label_a = Tex("a").next_to(ball, DOWN, buff=0.3)
        text_label_m = Tex("m").next_to(text_label_a, DOWN, buff=0.2)
        self.play(Create(text_label_a), Create(text_label_m))
        
        # Animate ball moving right
        self.play(ball.animate.shift(RIGHT*3), run_time=3)
        
        # Update arrows and labels to follow the ball
        force_arrow.shift(RIGHT*3)
        velocity_arrow.shift(RIGHT*3)
        acceleration_arrow.shift(RIGHT*3)
        text_label_F.shift(RIGHT*3)
        text_label_a.shift(RIGHT*3)
        text_label_m.shift(RIGHT*3)
        
        # Animate velocity arrow increasing in length
        new_end = ball.get_center() + RIGHT*3
        self.play(velocity_arrow.animate.set_end(new_end), run_time=2)
        
        # Fade out arrows and labels
        self.play(
            force_arrow.animate.set_opacity(0),
            acceleration_arrow.animate.set_opacity(0),
            velocity_arrow.animate.set_opacity(0),
            text_label_F.animate.set_opacity(0),
            text_label_a.animate.set_opacity(0),
            text_label_m.animate.set_opacity(0),
            run_time=2
        )