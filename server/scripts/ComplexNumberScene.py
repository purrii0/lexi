from manim import *

class ComplexNumberScene(Scene):
    def construct(self):
        # Create objects
        complex_number_plane = NumberPlane().set_opacity(0.5)
        real_axis = Line(LEFT * 10, RIGHT * 10).set_color(RED)
        imaginary_axis = Line(DOWN * 10, UP * 10).set_color(BLUE)
        number_vector = Arrow(ORIGIN, RIGHT * 3 + UP * 2, buff=0, color=YELLOW)
        
        # Show complex number plane
        self.play(Create(complex_number_plane))
        self.wait(1)
        
        # Show first caption
        caption1 = Text("जटिल सङ्ख्या परिचय", font_size=28).to_edge(DOWN)
        self.play(Write(caption1), run_time=2)
        self.wait(1)
        
        # Animate real axis
        self.play(Create(real_axis))
        self.wait(1)
        
        # Show second caption
        self.play(FadeOut(caption1))
        caption2 = Text("वास्तविक र कल्पना अक्ष", font_size=28).to_edge(DOWN)
        self.play(Write(caption2), run_time=3)
        self.wait(1)
        
        # Animate imaginary axis
        self.play(Create(imaginary_axis))
        self.wait(1)
        
        # Show third caption
        self.play(FadeOut(caption2))
        caption3 = Text("जटिल सङ्ख्या निरूपण", font_size=28).to_edge(DOWN)
        self.play(Write(caption3), run_time=4)
        self.wait(1)
        
        # Move number vector
        self.play(Create(number_vector))
        self.play(number_vector.animate.shift(RIGHT * 2 + UP * 1))
        self.wait(2)